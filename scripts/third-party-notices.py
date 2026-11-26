#!/usr/bin/env python3
"""Collect package attribution and the license texts shipped by dependencies."""
from pathlib import Path
import hashlib
import json
import runpy
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def license_files(directory):
    return sorted(
        p for p in directory.iterdir()
        if p.is_file() and p.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE"))
    )


def main():
    product_name = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["productName"]
    environment = runpy.run_path(str(ROOT / "scripts/build-desktop.py"))["build_environment"]()
    command = [
        "cargo", "metadata", "--manifest-path", str(ROOT / "src-tauri/Cargo.toml"),
        "--locked", "--offline", "--format-version", "1",
    ]
    metadata = json.loads(subprocess.check_output(command, cwd=ROOT, env=environment))
    sections = [
        "Third-party software notices",
        "",
        f"{product_name} includes software from the following projects. This inventory",
        "also lists platform-specific and build dependencies for reproducibility.",
        "WebView2 is a Microsoft product; its redistribution and use are governed",
        "by the terms included with the Microsoft WebView2 Runtime installer.",
        "",
    ]
    texts = {}
    inventory = []
    packages = sorted(metadata["packages"], key=lambda item: (item["name"], item["version"]))
    for package in packages:
        if not package.get("source"):
            continue
        directory = Path(package["manifest_path"]).parent
        paths = license_files(directory)
        if package.get("license_file"):
            path = directory / package["license_file"]
            if path.is_file() and path not in paths:
                paths.append(path)
        references = []
        for path in paths:
            text = path.read_text(errors="replace").strip()
            digest = hashlib.sha256(text.encode()).hexdigest()
            if digest not in texts:
                texts[digest] = (f"License text {len(texts) + 1}", text)
            references.append(texts[digest][0])
        inventory.append(f"{package['name']} {package['version']} | {package.get('license') or 'See license file'}")
        if package.get("repository"):
            inventory.append(f"  Source: {package['repository']}")
        if references:
            inventory.append("  Texts: " + ", ".join(references))
    for name in json.loads((ROOT / "package.json").read_text())["dependencies"]:
        directory = ROOT / "node_modules" / name
        package = json.loads((directory / "package.json").read_text())
        inventory.append(f"{name} {package['version']} | {package.get('license', 'See license file')}")
        for path in license_files(directory):
            text = path.read_text(errors="replace").strip()
            digest = hashlib.sha256(text.encode()).hexdigest()
            if digest not in texts:
                texts[digest] = (f"License text {len(texts) + 1}", text)
            inventory.append("  Texts: " + texts[digest][0])
    sections.extend(inventory)
    for label, text in texts.values():
        sections.extend(["", "=" * 72, label, "=" * 72, "", text])
    target = ROOT / "THIRD_PARTY_NOTICES.txt"
    target.write_text("\n".join(sections) + "\n")
    print(f"Wrote {target.name}: {len(packages) - 1} Rust packages, {len(texts)} license texts.")


if __name__ == "__main__":
    main()
