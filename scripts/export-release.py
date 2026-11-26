#!/usr/bin/env python3
"""Export the verified installers and a source backup into one release folder."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
PRODUCT_NAME = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["productName"]
FILE_PREFIX = PRODUCT_NAME.replace(" ", "")


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def main():
    report = json.loads((ROOT / "output/package-verification.json").read_text())
    assert report["version"] == VERSION, "核验报告版本与当前版本不一致"
    assert report["product_name"] == PRODUCT_NAME, "核验报告产品名称与当前名称不一致"
    release = ROOT / "releases" / VERSION
    release.mkdir(parents=True, exist_ok=True)
    installers = [
        (
            ROOT / f"src-tauri/target/release/bundle/dmg/{PRODUCT_NAME}_{VERSION}_aarch64.dmg",
            f"{FILE_PREFIX}-{VERSION}-macOS-AppleSilicon.dmg", report["macos"]["dmg_sha256"],
        ),
    ]
    for arch, target, label in [
        ("x64", "x86_64-pc-windows-msvc", "x64"),
        ("arm64", "aarch64-pc-windows-msvc", "ARM64"),
    ]:
        if arch in report["windows"]:
            installers.append((
                ROOT / f"src-tauri/target/{target}/release/bundle/nsis/{PRODUCT_NAME}_{VERSION}_{arch}-setup.exe",
                f"{FILE_PREFIX}-{VERSION}-Windows-{label}-offline.exe",
                report["windows"][arch]["installer_sha256"],
            ))
    manifest = {"version": VERSION, "product_name": PRODUCT_NAME, "verified": report, "files": []}
    for original, filename, expected in installers:
        assert sha256(original) == expected, "构建产物已更改，请先重新执行 verify-packages.py"
        target = release / filename
        shutil.copy2(original, target)
        manifest["files"].append({"name": filename, "bytes": target.stat().st_size, "sha256": sha256(target)})
    source_zip = release / f"{FILE_PREFIX}-{VERSION}-source.zip"
    files = [
        ROOT / name for name in [
            "package.json", "package-lock.json", "index.html", "README.md", "DESIGN.md",
            "THIRD_PARTY_NOTICES.txt", ".gitignore", "GITHUB_ACTIONS.md",
        ]
    ]
    for folder in ["src", "public", "tests", "scripts", "src-tauri", ".cargo", ".github"]:
        for directory, folders, names in os.walk(ROOT / folder):
            folders[:] = [name for name in folders if name not in {"target", "gen", "android", "ios", "__pycache__"}]
            files.extend(Path(directory) / name for name in names if name != ".DS_Store")
    with zipfile.ZipFile(source_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(files):
            archive.write(path, f"{FILE_PREFIX}-{VERSION}-source/{path.relative_to(ROOT)}")
    with zipfile.ZipFile(source_zip) as archive:
        assert archive.testzip() is None
    manifest["files"].append({"name": source_zip.name, "bytes": source_zip.stat().st_size, "sha256": sha256(source_zip)})
    windows_instructions = "\n".join(
        f"- **Windows {arch}**：`{FILE_PREFIX}-{VERSION}-Windows-{'ARM64' if arch == 'arm64' else 'x64'}-offline.exe`。适用于对应架构的 Windows 10 / 11。"
        for arch in report["windows"]
    )
    (release / "使用说明.md").write_text(f"""# {PRODUCT_NAME} {VERSION}

安装后直接点软件图标使用，不需要 Node.js、Python、Rust 或开发服务器。

## 选择安装包

- **Mac / Apple Silicon**：`{FILE_PREFIX}-{VERSION}-macOS-AppleSilicon.dmg`。打开后把 {PRODUCT_NAME} 拖入“应用程序”。适用于 Apple Silicon Mac，系统最低要求 macOS 11。
{windows_instructions}

虚拟机以 Windows 内“设置 → 系统 → 关于 → 系统类型”显示的架构为准。把对应的 `.exe` 复制到虚拟机，再双击安装。Windows 包内置微软 WebView2 完整离线安装组件；Mac 包内置全部应用资源，使用 macOS 提供的 WebKit。

本地自用构建：Windows 未使用商业开发者证书签名；Mac 使用本地 ad-hoc 签名，未做 Apple 公证。

未配置正式签名不代表只能在开发者自己的电脑使用，但首次安装或打开可能遇到系统信任提示。是否允许打开由接收者的系统设置及管理策略决定。请只在确认安装包来源和校验值后，按系统提供的方式处理；受管理电脑需要遵守管理员的策略。

## 使用

1. **文本转换**：输入原文后点“编码为 Base64”；输入 Base64 后点“解码 Base64”。中文通常选择 UTF-8，旧编码文本可选择 GBK / GB2312。
2. **文件与图片**：拖入或选择文件后编码；粘贴 Base64 / Data URI 后解码，再保存文件。单次原文件最大 50 MB。
3. **格式**：支持标准 Base64、Base64URL、十六进制字节和可选补位。Data URI 自动使用带补位的标准 Base64。
4. **快捷键**：Ctrl / ⌘ + Enter 编码，加 Shift 解码。结果可以复制、保存或移回输入区。

转换在本机完成，不连接原网站，不上传内容，不记录转换历史。Base64 是可还原的编码方式，不能代替加密。

## 备份

保留对应平台的安装包和 `{FILE_PREFIX}-{VERSION}-source.zip`。源码备份包含转换逻辑、界面、桌面打包配置及依赖锁文件；开发工具缓存没有放进源码 ZIP。

验证范围见 `验证记录.md`，文件校验值见 `SHA256SUMS.txt`。
""")
    runtime_rows = "\n".join(
        f"| Windows {arch} | {data['runtime_bytes']:,} 字节 | `{data['runtime_sha256']}` |"
        for arch, data in report["windows"].items()
    )
    native = report["macos"].get("native_verification") or {}
    native_summary = "\n".join(f"- {description}" for description in native.get("verified_actions", []))
    if not native_summary:
        native_summary = "- 本次未记录 Mac 窗口的实际操作验证。"
    (release / "验证记录.md").write_text(f"""# {PRODUCT_NAME} {VERSION} 验证记录

构建与验证日期：{report["verified_at"][:10]}。构建机：Apple Silicon Mac。

## 已完成

- {report['core_tests']} 项转换逻辑测试通过，覆盖 UTF-8、GBK、中文、表情、标准样例、非法输入、补位、Base64URL、Data URI、十六进制和随机二进制。
- {report['ui_tests']} 项界面检查通过，包含模拟断网后的文本转换、图片预览、文件下载、格式选项兼容、快捷键及窄窗口显示。转换期间未发现外部 HTTP 请求。
- 解码下载的图片与原文件 SHA-256 一致。
{native_summary}
- 最终 Mac DMG 校验通过，已只读挂载检查内置应用；应用本地签名校验通过，包内二进制与构建产物一致。
- 本次导出的 Windows NSIS 安装包均已解包检查。内置的是完整 WebView2 离线组件，SHA-256 与此前缓存的完整离线组件一致。
- 包内 Windows 主程序的处理器架构已核对，除 Tauri 正常安装格式标记外与编译产物一致；未发现需要另装 VC++ Redistributable 的 DLL 导入。
- 安装包内第三方许可文件已核对；源码 ZIP 的 CRC 校验通过。

## Windows 验证边界

Windows 安装包在 Mac 上交叉编译并完成上述内容检查。本次没有在真实 Windows 10 虚拟机中执行安装器或打开应用，因此尚未验证该虚拟机里的实际安装、首次启动和原生对话框。

## WebView2 完整离线组件

| 架构 | 组件体积 | SHA-256 |
|---|---:|---|
{runtime_rows}

## 签名

Mac 使用 ad-hoc 本地签名，未做 Apple 公证。Windows 安装包未配置商业开发者证书签名。
""")
    (release / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    checksums = []
    for path in sorted(release.iterdir()):
        if path.is_file() and path.name != "SHA256SUMS.txt":
            checksums.append(f"{sha256(path)}  {path.name}")
    (release / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n")
    print(release)
    for item in manifest["files"]:
        print(f"{item['name']}: {item['bytes'] / 1_000_000:.2f} MB")


if __name__ == "__main__":
    main()
