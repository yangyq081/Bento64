# Bento64 自动构建

仓库：[yangyq081/Bento64](https://github.com/yangyq081/Bento64)，现已公开。

普通用户请前往 [Releases 发布页](https://github.com/yangyq081/Bento64/releases/latest) 下载安装包，无需 GitHub 账号。当前已发布 0.2.1 的 Mac Apple Silicon DMG 和 Windows x64 完整离线 EXE，附带 SHA-256 校验值。

下文的 Actions 构建产物用于测试和验证，需要登录 GitHub 后下载，默认保留 14 天。Releases 中上传的安装包不受这个 14 天保留期限制。

## 使用

1. 打开仓库的 **Actions**。
2. 选择 **Build Bento64 desktop packages**。
3. 点击 **Run workflow**，通常保留 Windows 安装检查勾选。
4. 等待两个平台的任务完成。
5. 在本次运行底部的 **Artifacts** 下载：
   - `Bento64-macOS-AppleSilicon`：Apple 芯片版 DMG。
   - `Bento64-Windows-x64`：含 WebView2 完整离线组件的 x64 EXE。

Artifacts 下载后是 ZIP，解压后才是安装包。文件夹内附带 SHA-256 校验值、版本清单、检查报告和说明，默认保留 14 天；需要长期留存时请自行下载备份。

源码推送到 `main` / `master`、相关代码的 Pull Request、推送 `v*` 标签也会触发构建。工作流会生成可下载的构建产物；公开 Release 需要另外发布，当前工作流不会自动发布新版本。

## 检查范围

两个平台均执行转换逻辑测试，使用锁文件安装依赖，再在各自操作系统上编译。

Mac 检查 Apple Silicon 架构、版本、应用图标、本地签名、DMG 完整性，并只读挂载确认安装包内的主程序及许可文件正确。

Windows 检查 x64 架构，解包确认主程序和许可文件正确，核对 WebView2 组件为完整离线包并检查其微软签名。启用安装检查时，还会：

- 在 runner 临时目录中静默安装。
- 检查实际安装的程序、卸载器、许可文件和版本信息。
- 启动应用，检查是否能持续运行至少 8 秒，记录是否观察到主窗口。
- 关闭本次启动的测试进程，执行卸载，检查主程序是否移除。

这属于安装与启动的基础检查，不等于完整的 GUI 功能测试。GitHub 托管的 Windows runner 与普通 Windows 10 用户电脑的权限、安全软件和磁盘配置不同，不能仅凭这里通过就认定用户电脑的 `D:\Bento64` 写入错误已解决。

失败的任务会上传 `diagnostics-*` 诊断产物，正常安装包只在检查成功后上传。

## 签名

目前 Mac 使用 ad-hoc 本地签名，尚未配置 Apple Developer ID 或公证；Windows 应用未配置开发者证书签名。GitHub Actions 自动编译不会改变这一点。

后续正式签名需要将自己的证书及相应凭据安全地配置为 GitHub Secrets，不能直接写进源码或工作流文件。

## 源码布局

`.github/workflows/build-desktop.yml` 必须位于 GitHub 仓库根目录的 `.github/workflows/` 中；`package.json` 和 `src-tauri/` 也位于同一个仓库根目录。只上传两个安装包无法重新编译应用，需要这个项目的源码及锁文件。

开发机上的 `.tools/`、`node_modules/`、`src-tauri/target/`、`output/` 和历史安装包不会提交到仓库。启动动画的 SVG 字形已经生成，构建时不需要安装设计字体。
