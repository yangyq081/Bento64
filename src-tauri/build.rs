fn main() {
    // Cargo target flags provide the fully static CRT. Keep Tauri from
    // replacing it with its mixed static-VC / dynamic-UCRT configuration.
    let windows = tauri_build::WindowsAttributes::new().static_vc_runtime(false);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("无法生成桌面应用资源");
}
