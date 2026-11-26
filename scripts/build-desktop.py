#!/usr/bin/env python3
"""Rebuild the native packages, using project-local tools when available."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess

PROJECT = Path(__file__).resolve().parent.parent
TOOLS = PROJECT / ".tools"


def build_environment():
    env = os.environ.copy()
    paths = []
    if (TOOLS / "cargo" / "bin" / "cargo").exists():
        env["CARGO_HOME"] = str(TOOLS / "cargo")
        env["RUSTUP_HOME"] = str(TOOLS / "rustup")
        paths.append(TOOLS / "cargo" / "bin")
    for pattern in ["llvm-bottle/llvm@19/*/bin", "lld-bottle/lld@19/*/bin", "xwin-bin"]:
        paths.extend(path for path in TOOLS.glob(pattern) if path.is_dir())
    nsis_dirs = sorted(
        TOOLS.glob("nsis-resources/nsis-*/bin"),
        key=lambda path: tuple(int(part) for part in path.parent.name.removeprefix("nsis-").split(".")),
        reverse=True,
    )
    if nsis_dirs and (nsis_dirs[0] / "makensis").exists():
        # Tauri clears NSISDIR, so use the standard resource-root/bin layout.
        paths.append(nsis_dirs[0])
    dylibs = []
    for pattern in ["llvm-bottle/llvm@19/*/lib", "zstd-bottle/zstd/*/lib"]:
        dylibs.extend(str(path) for path in TOOLS.glob(pattern) if path.is_dir())
    if dylibs:
        env["DYLD_LIBRARY_PATH"] = os.pathsep.join(dylibs)
    env["PATH"] = os.pathsep.join([*map(str, paths), env.get("PATH", "")])
    env["XWIN_CACHE_DIR"] = str(TOOLS / "xwin-cache")
    env["CARGO_HTTP_MULTIPLEXING"] = "false"
    return env


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("platform", choices=["macos", "windows-x64", "windows-arm64"])
    parser.add_argument("--app-only", action="store_true")
    args = parser.parse_args()
    env = build_environment()
    if not shutil.which("cargo", path=env["PATH"]):
        raise SystemExit("请先安装 Rust 和所需目标工具链，参见 README.md。")
    command = ["npm", "run", "tauri", "--", "build"]
    if args.platform == "macos":
        command.extend(["--bundles", "app" if args.app_only else "app,dmg"])
    else:
        target = "x86_64-pc-windows-msvc" if args.platform == "windows-x64" else "aarch64-pc-windows-msvc"
        if os.name != "nt":
            command.extend(["--runner", "cargo-xwin"])
        command.extend(["--target", target, "--bundles", "nsis"])
    raise SystemExit(subprocess.run(command, cwd=PROJECT, env=env).returncode)


if __name__ == "__main__":
    main()
