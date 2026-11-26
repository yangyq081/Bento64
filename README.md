# Bento64 / 本地编码

安装在电脑上的离线 Base64 工具，使用 Tauri 桌面窗口。应用包内包含界面、转换代码、图标和字符集处理逻辑。转换不依赖 base64.us 或其他服务器，不需要账号，不保存转换历史。

## 下载

在 [Releases 发布页](https://github.com/yangyq081/Bento64/releases/latest) 下载安装包，无需编译源码：

| 平台 | 0.2.1 安装包 | 大小 |
| --- | --- | --- |
| Mac Apple 芯片 | [Bento64 DMG](https://github.com/yangyq081/Bento64/releases/download/v0.2.1/Bento64-0.2.1-macOS-AppleSilicon.dmg) | 1.87 MB |
| Windows x64 | [Bento64 完整离线 EXE](https://github.com/yangyq081/Bento64/releases/download/v0.2.1/Bento64-0.2.1-Windows-x64-offline.exe) | 299.63 MB |

Windows 包含 WebView2 完整离线安装组件。Mac 包适用于 Apple Silicon，要求 macOS 11 或更新版本。校验值、验证范围和签名状态见发布说明；Windows 应用未配置开发者证书，Mac 使用 ad-hoc 本地签名、未公证。

## 功能

- 文本 Base64 编码与解码，支持 UTF-8 和 GBK（兼容常见 GB2312 文本）。
- 标准 Base64、Base64URL、可选的末尾补位；解码自动识别 URL 字符和缺失的补位。
- 十六进制字节输入与输出。
- 图片与任意文件编码，支持 Data URI；解码为文件并通过系统保存对话框保存。
- PNG、JPEG、GIF、WebP 和 BMP 解码预览。其他类型可保存为文件。
- 最大原文件 50 MB；遇到非法输入、截断内容或不支持的字符会明确报错。
- 复制、清空、结果移到输入；Ctrl / ⌘ + Enter 编码，加 Shift 解码。

Base64 是编码方式，不提供加密保密功能。

## 桌面安装包

Windows 的安装配置采用 `offlineInstaller`，将微软 WebView2 Evergreen Standalone Installer 完整带入安装包。安装应用时无需联网下载 WebView2。如果机器已有满足要求的 WebView2，安装器使用现有组件。Windows 运行库采用静态 CRT 链接。

macOS 的应用包内置所有应用资源，使用随 macOS 提供的 WKWebView，无首次启动依赖下载。当前 Mac 安装包适用于 Apple Silicon；系统最低要求为 macOS 11。

Windows 安装包按处理器架构区分。x64 安装包适用于 x64 Windows；ARM64 Windows 需要 ARM64 构建。请在虚拟机的“设置 → 系统 → 关于”查看系统类型。

当前安装包未配置商业开发者证书签名或 Apple 公证。

## 开发

需要 Node.js、Rust、对应平台的编译依赖。安装 JavaScript 依赖后：

```sh
npm ci
npm test
npm run desktop:dev
```

`npm run dev` 仅用于浏览器中预览界面；最终 App 将 `dist/` 的内容直接内置，不需要这个开发服务器。

## 重新打包

```sh
python3 scripts/build-desktop.py macos
python3 scripts/build-desktop.py windows-x64
```

脚本优先使用本项目 `.tools/` 下的工具，否则使用系统已安装的工具。Windows 跨平台打包还需要 NSIS、LLVM / LLD、cargo-xwin 和 Rust Windows MSVC 目标。当前 Windows 配置默认包含 WebView2 完整离线安装器，不要改成联网 bootstrapper。

首次构建需要联网下载依赖。已经生成的桌面应用和完整离线安装包不依赖开发工具。

## 验证

- `npm test`：RFC 风格的 Base64 样例、中文、表情、GBK、非法输入、补位、Data URI、随机二进制、十六进制和文件名处理。
- `scripts/ui-smoke.js`：供 Playwright CLI `run-code` 执行的界面检查，包含模拟断网后的转换、图片预览与文件下载。
- 对解码保存的文件与原文件比较 SHA-256，确认字节一致。
- `python3 scripts/verify-packages.py --windows x64 --ui-log output/release-ui-smoke-0.2.1.log --mac-native-report output/mac-native-verification-0.2.1.json`：核对本次 Windows x64 的处理器架构、完整 WebView2 组件、主程序和图标，并只读挂载检查 Mac DMG、图标、本地签名与版本。
- `python3 scripts/export-release.py`：通过上述核验后，导出安装包、源码 ZIP、使用说明及 SHA-256 清单。

平台原生安装和离线启动的实际验证结果以发布目录中的 `验证记录.md` 为准。

## GitHub 自动构建

`.github/workflows/build-desktop.yml` 会分别在 macOS 与 Windows runner 上编译 Apple Silicon DMG 和 Windows x64 完整离线 EXE，并上传为 Actions 构建产物。Windows 还可执行基础安装、启动及卸载检查。

使用方式、检查边界和下载位置见 [GITHUB_ACTIONS.md](GITHUB_ACTIONS.md)。自动编译不等于正式签名或 Apple 公证，也不能代替普通 Windows 用户环境的完整测试。

## 文件

- `src/codec.js`：纯本地转换和校验逻辑。
- `src/main.js`：界面交互、系统保存对话框和剪贴板。
- `src-tauri/`：原生桌面应用、权限和完整离线安装配置。
- `tests/`：转换逻辑测试。
- `scripts/`：构建和界面验证脚本。
- `releases/`：最终安装包、源码备份及验证记录。
