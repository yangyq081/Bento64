#!/usr/bin/env python3
"""Inspect the offline packages produced on the Mac build machine."""
from pathlib import Path
import argparse
from datetime import datetime
import hashlib
import json
import plistlib
import re
import struct
import subprocess
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / ".tools"
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
PRODUCT_NAME = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["productName"]


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--windows", nargs="+", choices=["x64", "arm64"], default=["x64", "arm64"])
    parser.add_argument("--ui-log", type=Path, default=ROOT / "output/playwright/ui-smoke.log")
    parser.add_argument("--mac-native-report", type=Path)
    args = parser.parse_args()
    tests = subprocess.run(["npm", "test"], cwd=ROOT, capture_output=True, text=True, check=True)
    (ROOT / "output/core-tests.log").write_text(tests.stdout + tests.stderr)
    count = int(re.search(r"tests (\d+)", tests.stdout).group(1))
    ui_log = args.ui_log.read_text()
    ui = json.loads(ui_log.split("### Result\n", 1)[1].split("\n", 1)[0])
    assert not ui["errors"] and not ui["externalRequests"]
    report = {
        "version": VERSION, "product_name": PRODUCT_NAME, "verified_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(),
        "core_tests": count, "ui_tests": ui["passed"], "windows": {},
    }
    for arch, target, machine in [
        ("x64", "x86_64-pc-windows-msvc", 0x8664),
        ("arm64", "aarch64-pc-windows-msvc", 0xAA64),
    ]:
        if arch not in args.windows:
            continue
        native = ROOT / "src-tauri/target" / target / "release"
        installer = native / "bundle/nsis" / f"{PRODUCT_NAME}_{VERSION}_{arch}-setup.exe"
        inspection = ROOT / "output" / f"windows-{arch}-{VERSION}-extracted"
        inspection.mkdir(parents=True, exist_ok=True)
        command = [
            str(TOOLS / "7zip/7zz"), "e", "-y", "-o" + str(inspection), str(installer),
            "$TEMP/MicrosoftEdgeWebView2RuntimeInstaller.exe", "base64-local.exe",
            "THIRD_PARTY_NOTICES.txt",
        ]
        subprocess.run(command, check=True, capture_output=True)
        embedded = inspection / "MicrosoftEdgeWebView2RuntimeInstaller.exe"
        runtime_sha = sha256(embedded)
        candidates = (Path.home() / "Library/Caches/tauri" / arch).glob("*/*.exe")
        assert any(sha256(path) == runtime_sha for path in candidates)
        assert embedded.stat().st_size > 100_000_000
        expected = (native / "base64-local.exe").read_bytes()
        actual = (inspection / "base64-local.exe").read_bytes()
        # The bundler sets this three-byte marker only in the packaged binary.
        marker = b"__TAURI_BUNDLE_TYPE_VAR_UNK"
        installed_marker = b"__TAURI_BUNDLE_TYPE_VAR_NSS"
        assert actual == expected or any(
            actual == expected[:match.start()] + installed_marker + expected[match.end():]
            for match in re.finditer(re.escape(marker), expected)
        )
        pe_offset = struct.unpack_from("<I", actual, 0x3C)[0]
        assert struct.unpack_from("<H", actual, pe_offset + 4)[0] == machine
        imports = subprocess.check_output(
            [str(TOOLS / "llvm-bottle/llvm@19/19.1.7/bin/llvm-readobj"),
             "--coff-imports", str(inspection / "base64-local.exe")],
            text=True,
        ).lower()
        assert "vcruntime140.dll" not in imports and "msvcp140.dll" not in imports
        assert sha256(inspection / "THIRD_PARTY_NOTICES.txt") == sha256(ROOT / "THIRD_PARTY_NOTICES.txt")
        icon = (ROOT / "src-tauri/icons/icon.ico").read_bytes()
        _, icon_type, icon_count = struct.unpack_from("<HHH", icon)
        assert icon_type == 1
        for index in range(icon_count):
            size, offset = struct.unpack_from("<II", icon, 6 + index * 16 + 8)
            embedded_icon = subprocess.check_output([
                str(TOOLS / "7zip/7zz"), "e", "-so", str(inspection / "base64-local.exe"),
                f".rsrc/ICON/{index + 1}",
            ])
            assert embedded_icon == icon[offset:offset + size]
        report["windows"][arch] = {
            "installer_bytes": installer.stat().st_size, "installer_sha256": sha256(installer),
            "runtime_bytes": embedded.stat().st_size, "runtime_sha256": runtime_sha,
            "application_bytes": len(actual), "application_sha256": hashlib.sha256(actual).hexdigest(),
            "machine": hex(machine), "payload_verified": True,
            "icon_sizes_verified": icon_count,
        }
        print(f"Verified Windows {arch}: full offline runtime and application payload.", flush=True)
    dmg = ROOT / "src-tauri/target/release/bundle/dmg" / f"{PRODUCT_NAME}_{VERSION}_aarch64.dmg"
    subprocess.run(["hdiutil", "verify", str(dmg)], check=True, capture_output=True)
    mount = ROOT / "output/dmg-inspection"
    mount.mkdir(exist_ok=True)
    attached = False
    try:
        subprocess.run(
            ["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", "-mountpoint", str(mount), str(dmg)],
            check=True, capture_output=True,
        )
        attached = True
        mounted = mount / f"{PRODUCT_NAME}.app"
        info = plistlib.loads((mounted / "Contents/Info.plist").read_bytes())
        assert info["CFBundleShortVersionString"] == VERSION
        assert info["CFBundleName"] == PRODUCT_NAME
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(mounted)], check=True, capture_output=True)
        built = ROOT / "src-tauri/target/release/bundle/macos" / f"{PRODUCT_NAME}.app"
        assert sha256(mounted / "Contents/MacOS/base64-local") == sha256(built / "Contents/MacOS/base64-local")
        assert sha256(mounted / "Contents/Resources/THIRD_PARTY_NOTICES.txt") == sha256(ROOT / "THIRD_PARTY_NOTICES.txt")
        assert sha256(mounted / "Contents/Resources" / info["CFBundleIconFile"]) == sha256(ROOT / "src-tauri/icons/icon.icns")
        native_report = None
        if args.mac_native_report:
            native_report = json.loads(args.mac_native_report.read_text())
            assert native_report["version"] == VERSION
        report["macos"] = {
            "dmg_bytes": dmg.stat().st_size, "dmg_sha256": sha256(dmg),
            "signature": "ad-hoc, verified", "mounted_application_verified": True,
            "version_verified": VERSION, "icon_verified": True,
            "native_verification": native_report,
        }
    finally:
        if attached:
            subprocess.run(["hdiutil", "detach", str(mount)], check=True, capture_output=True)
    (ROOT / "output/package-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Verified macOS DMG and signature. {count} core tests and {ui['passed']} UI checks passed.", flush=True)


if __name__ == "__main__":
    main()
