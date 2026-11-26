#!/usr/bin/env python3
"""Check platform-native build outputs and prepare downloadable CI artifacts."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import struct
import subprocess
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[2]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def run(command: list[str], **kwargs) -> str:
    return subprocess.check_output(command, text=True, **kwargs)


def metadata() -> tuple[str, str, str]:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    cargo = tomllib.loads((ROOT / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))
    version = package["version"]
    require(version == config["version"] == cargo["package"]["version"], "Application versions disagree")
    product = config["productName"]
    binary = cargo["package"]["name"]
    require(bool(re.fullmatch(r"[\w .-]+", product)), "Unexpected product name")
    require(bool(re.fullmatch(r"[\w.-]+", version)), "Unexpected application version")
    return product, version, binary


def pe_machine(path: Path) -> int:
    with path.open("rb") as source:
        head = source.read(64)
        require(head[:2] == b"MZ", f"Not a Windows executable: {path}")
        source.seek(struct.unpack_from("<I", head, 0x3C)[0])
        pe = source.read(6)
    require(pe[:4] == b"PE\0\0", f"Invalid PE signature: {path}")
    return struct.unpack_from("<H", pe, 4)[0]


def windows_checks(release: Path, installer: Path, binary: str) -> dict:
    require(os.name == "nt", "Windows payload checks must run on Windows")
    program = release / f"{binary}.exe"
    require(pe_machine(program) == 0x8664, "The program is not Windows x64")
    seven_zip = shutil.which("7z")
    if not seven_zip:
        candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "7-Zip/7z.exe"
        require(candidate.is_file(), "The Windows runner needs 7-Zip")
        seven_zip = str(candidate)
    with tempfile.TemporaryDirectory(prefix="bento64-payload-") as work:
        extracted = Path(work)
        run([
            seven_zip, "e", "-y", f"-o{extracted}", str(installer),
            "$TEMP/MicrosoftEdgeWebView2RuntimeInstaller.exe",
            f"{binary}.exe", "THIRD_PARTY_NOTICES.txt",
        ])
        runtime = extracted / "MicrosoftEdgeWebView2RuntimeInstaller.exe"
        require(runtime.is_file() and runtime.stat().st_size > 100_000_000, "Full offline WebView2 runtime is missing")
        expected = program.read_bytes()
        actual = (extracted / f"{binary}.exe").read_bytes()
        marker = b"__TAURI_BUNDLE_TYPE_VAR_UNK"
        installed_marker = b"__TAURI_BUNDLE_TYPE_VAR_NSS"
        matches = actual == expected or any(
            actual == expected[:match.start()] + installed_marker + expected[match.end():]
            for match in re.finditer(re.escape(marker), expected)
        )
        require(matches, "The embedded application differs from the compiled application")
        require(
            digest(extracted / "THIRD_PARTY_NOTICES.txt") == digest(ROOT / "THIRD_PARTY_NOTICES.txt"),
            "The embedded license notice is incorrect",
        )
        env = os.environ.copy()
        env["BENTO64_CI_RUNTIME"] = str(runtime)
        signature = json.loads(run([
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "$s=Get-AuthenticodeSignature -LiteralPath $env:BENTO64_CI_RUNTIME;"
            "[pscustomobject]@{status=[string]$s.Status;subject=[string]$s.SignerCertificate.Subject}"
            "|ConvertTo-Json -Compress",
        ], env=env))
        require(signature["status"] == "Valid", f"WebView2 signature validation failed: {signature['status']}")
        require("Microsoft" in signature["subject"], "The offline runtime is not signed by Microsoft")
        return {
            "architecture": "x64",
            "embedded_program_matches": True,
            "licenses_verified": True,
            "runtime_bytes": runtime.stat().st_size,
            "runtime_sha256": digest(runtime),
            "runtime_signature": signature,
            "application_sha256": hashlib.sha256(actual).hexdigest(),
            "publisher_signing": "not configured",
        }


def mac_checks(release: Path, installer: Path, product: str, version: str, binary: str) -> dict:
    app = release / "bundle/macos" / f"{product}.app"
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    executable_name = info.get("CFBundleExecutable", binary)
    require(Path(executable_name).name == executable_name, "Unexpected Mac executable path")
    executable = app / "Contents/MacOS" / executable_name
    with executable.open("rb") as source:
        magic, cpu = struct.unpack("<II", source.read(8))
    require(magic == 0xFEEDFACF and cpu == 0x0100000C, "The Mac program is not Apple Silicon")
    require(info["CFBundleName"] == product and info["CFBundleShortVersionString"] == version, "Mac bundle metadata is incorrect")
    run(["codesign", "--verify", "--deep", "--strict", str(app)], stderr=subprocess.STDOUT)
    run(["hdiutil", "verify", str(installer)], stderr=subprocess.STDOUT)
    with tempfile.TemporaryDirectory(prefix="bento64-dmg-") as work:
        mount = Path(work) / "mount"
        mount.mkdir()
        attached = False
        try:
            run(["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", "-mountpoint", str(mount), str(installer)])
            attached = True
            mounted = mount / f"{product}.app"
            require(digest(mounted / "Contents/MacOS" / executable_name) == digest(executable), "DMG contains a different executable")
            require(
                digest(mounted / "Contents/Resources/THIRD_PARTY_NOTICES.txt") == digest(ROOT / "THIRD_PARTY_NOTICES.txt"),
                "Mac license notice is incorrect",
            )
            require(
                digest(mounted / "Contents/Resources" / info["CFBundleIconFile"]) == digest(ROOT / "src-tauri/icons/icon.icns"),
                "The Mac icon does not match the source icon",
            )
        finally:
            if attached:
                run(["hdiutil", "detach", str(mount)])
    return {
        "architecture": "Apple Silicon",
        "dmg_integrity_verified": True,
        "embedded_program_matches": True,
        "licenses_verified": True,
        "icon_verified": True,
        "application_sha256": digest(executable),
        "publisher_signing": "ad-hoc; not notarized",
    }


def checksums(output: Path) -> None:
    require(output.is_dir(), f"Artifact directory does not exist: {output}")
    rows = [
        f"{digest(path)}  {path.name}"
        for path in sorted(output.iterdir())
        if path.is_file() and path.name != "SHA256SUMS.txt"
    ]
    (output / "SHA256SUMS.txt").write_text("\n".join(rows) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", choices=["macos-arm64", "windows-x64"])
    parser.add_argument("--target")
    parser.add_argument("--release-dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--refresh-checksums", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    if args.refresh_checksums:
        checksums(output)
        return
    require(args.platform is not None, "--platform is required")
    require(bool(args.target) or args.release_dir is not None, "--target or --release-dir is required")
    product, version, binary = metadata()
    release = args.release_dir.resolve() if args.release_dir else ROOT / "src-tauri/target" / args.target / "release"
    if args.platform == "windows-x64":
        installer = release / "bundle/nsis" / f"{product}_{version}_x64-setup.exe"
        filename = f"{product}-{version}-Windows-x64-offline.exe"
    else:
        installer = release / "bundle/dmg" / f"{product}_{version}_aarch64.dmg"
        filename = f"{product}-{version}-macOS-AppleSilicon.dmg"
    require(installer.is_file(), f"Expected installer is missing: {installer}")
    verification = (
        windows_checks(release, installer, binary)
        if args.platform == "windows-x64"
        else mac_checks(release, installer, product, version, binary)
    )
    core_log = ROOT / "output/ci/core-tests.log"
    require(core_log.is_file(), "The core test log is missing")
    tests = re.search(r"tests\s+(\d+)", core_log.read_text(encoding="utf-8", errors="replace"))
    require(tests is not None, "Cannot find the test count in the core test log")
    output.mkdir(parents=True, exist_ok=True)
    shutil.copy2(installer, output / filename)
    shutil.copy2(core_log, output / "core-tests.log")
    report = {
        "product": product, "version": version, "platform": args.platform, "binary_name": binary,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "core_tests": int(tests.group(1)),
        "build_run": f"{os.environ.get('GITHUB_SERVER_URL', '')}/{os.environ.get('GITHUB_REPOSITORY', '')}/actions/runs/{os.environ.get('GITHUB_RUN_ID', '')}",
        "installer": {"name": filename, "bytes": installer.stat().st_size, "sha256": digest(installer)},
        "verification": verification,
    }
    (output / "build-manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    notes = f"""# {product} {version}

安装包：{filename}
平台：{args.platform}

Mac：打开 DMG，把 Bento64 拖入应用程序。此构建使用本地 ad-hoc 签名，未做 Apple 公证。
Windows：将离线 EXE 复制到 x64 Windows 后安装。包内含完整 WebView2 离线组件；应用未配置开发者证书签名。

校验结果见 build-manifest.json，文件校验值见 SHA256SUMS.txt。
Windows 若启用了安装检查，结果在 windows-install-check.json 中。
CI 的 Windows runner 并不等于 Windows 10 普通用户电脑；安装或启动检查不能替代完整 GUI 功能测试，也不能证明你电脑的 D 盘权限正常。
"""
    (output / "使用说明.txt").write_text(notes, encoding="utf-8")
    checksums(output)
    print(f"Prepared {filename}: {installer.stat().st_size / 1_000_000:.2f} MB")


if __name__ == "__main__":
    main()
