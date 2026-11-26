"""Prepare portable SVG artwork for the B startup and its rounded wordmark.

Run with fontTools available on PYTHONPATH. The saved artwork contains paths,
so viewers need neither fontTools nor the design fonts.
"""

from __future__ import annotations

import json
from pathlib import Path
from xml.etree import ElementTree as ET

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
FONT_ROOT = Path("/System/Library/Fonts/Supplemental")
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


def get_glyphs(font_path: Path, characters: str) -> dict:
    font = TTFont(font_path)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    factor = 1000 / font["head"].unitsPerEm
    result = {}
    for character in characters:
        name = cmap[ord(character)]
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(TransformPen(pen, (factor, 0, 0, -factor, 0, 0)))
        bounds = BoundsPen(glyph_set)
        glyph_set[name].draw(TransformPen(bounds, (factor, 0, 0, -factor, 0, 0)))
        result[character] = {
            "path": pen.getCommands(),
            "advance": font["hmtx"][name][0] * factor,
            "bounds": bounds.bounds,
        }
    return result


def mix_colors(start: str, end: str, ratio: float) -> str:
    channels = [
        round(int(start[index:index + 2], 16) * (1 - ratio) + int(end[index:index + 2], 16) * ratio)
        for index in (1, 3, 5)
    ]
    return "#" + "".join(f"{channel:02X}" for channel in channels)


def raised_letter(character: str, face: str, near: str, far: str, depth: float = 64) -> str:
    """Connected side layers give the letter thickness rather than a detached shadow."""
    layers = []
    for step in range(8, 0, -1):
        offset = depth * step / 8
        color = mix_colors(near, far, step / 8)
        layers.append(
            f'<use class="brand-letter-depth" href="#brand-outline-{character}" '
            f'transform="translate({offset} {offset})" fill="{color}"/>'
        )
    layers.append(f'<use class="brand-letter-face" href="#brand-outline-{character}" fill="{face}"/>')
    return "".join(layers)


def main() -> None:
    rounded = get_glyphs(FONT_ROOT / "Arial Rounded Bold.ttf", "Base64")
    heavy = get_glyphs(FONT_ROOT / "Arial Black.ttf", "B")
    initial_colors = ["#FFD166", "#F4A6A6", "#A8D5BA", "#D5B4E7", "#A7C7E7", "#FCD6B8"]
    side_colors = [
        ("#F6C452", "#F0B948"),
        ("#E99B9D", "#D38588"),
        ("#9BC9AE", "#80AF92"),
        ("#C8A7DD", "#AC8AC4"),
        ("#99BDDF", "#7EA4CA"),
        ("#F0C7A7", "#DCAF8B"),
    ]
    definitions = "<defs>" + "".join(
        f'<path id="brand-outline-{character}" d="{rounded[character]["path"]}"/>'
        for character in "Base64"
    ) + "</defs>"
    colors = initial_colors
    scatter = [
        (250, 275, 250, -4),
        (390, 242, 60, -9),
        (453, 193, 64, 5),
        (516, 233, 55, -8),
        (577, 168, 72, 12),
        (642, 221, 58, -10),
    ]
    word_size, baseline, tracking = 88, 264, 1.5
    base_scale, icon_width, icon_gap = .32, 240 * .32, 13
    total = icon_width + icon_gap + sum(rounded[c]["advance"] * word_size / 1000 for c in "ase64") + tracking * 4
    icon_left = (760 - total) / 2
    icon_center = icon_left + icon_width / 2
    base_x, base_y = icon_center - 250 * base_scale, 252 - 295 * base_scale
    cursor = icon_left + icon_width + icon_gap
    word_paths, opening_paths, metadata, all_bounds = [], [], [], []
    for index, character in enumerate("Base64"):
        glyph = rounded[character]
        x, y, size, angle = scatter[index]
        origin = glyph["advance"] / 2
        scatter_transform = f"translate({x} {y}) rotate({angle}) scale({size / 1000}) translate({-origin} 0)"
        final_size = 100 if index == 0 else word_size
        final_baseline = 246 if index == 0 else baseline
        final_x = icon_center - glyph["advance"] * final_size / 2000 if index == 0 else cursor
        word_transform = f"translate({final_x} {final_baseline}) scale({final_size / 1000})"
        near, far = side_colors[index]
        depth = 48 if index == 0 else 64
        volume = raised_letter(character, initial_colors[index], near, far, depth)
        word_paths.append(f'<g transform="{word_transform}">{volume}</g>')
        opening_paths.append(
            f'<g class="brand-glyph" data-character="{character}" transform="{scatter_transform}" fill="{initial_colors[index]}">'
            f'{volume}</g>'
        )
        metadata.append({
            "character": character, "x": x, "y": y, "size": size, "angle": angle,
            "origin": origin, "wordX": final_x, "baseline": final_baseline, "wordSize": final_size,
            "color": colors[index], "initialColor": initial_colors[index],
        })
        x0, y0, x1, y1 = glyph["bounds"]
        all_bounds.append((final_x + x0 * final_size / 1000, final_baseline + y0 * final_size / 1000,
                           final_x + (x1 + depth) * final_size / 1000, final_baseline + (y1 + depth) * final_size / 1000))
        if index:
            cursor += glyph["advance"] * word_size / 1000 + tracking
    all_bounds.append((icon_left, 252, icon_left + icon_width, base_y + 453 * base_scale))
    x0 = min(b[0] for b in all_bounds) - 4
    y0 = min(b[1] for b in all_bounds) - 4
    x1 = max(b[2] for b in all_bounds) + 4
    y1 = max(b[3] for b in all_bounds) + 4
    box = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
    viewbox = f'{x0:.4f} {y0:.4f} {box["width"]:.4f} {box["height"]:.4f}'
    base = """
      <g class="brand-base">
        <ellipse cx="250" cy="446" rx="106" ry="7" fill="#e5eff7" opacity=".5"/>
        <rect x="130" y="305" width="240" height="140" rx="35" fill="#E5EFF7"/>
        <rect x="130" y="295" width="240" height="140" rx="35" fill="#A7C7E7"/>
        <g fill="#fff" opacity=".6">
          <rect x="180" y="335" width="140" height="10" rx="5"/>
          <rect x="180" y="360" width="100" height="10" rx="5"/>
          <rect x="210" y="385" width="80" height="10" rx="5"/>
        </g>
      </g>"""
    (ROOT / "public/brand-wordmark.svg").write_text(
        f'<svg xmlns="{SVG_NS}" viewBox="{viewbox}" role="img" aria-label="Base64">'
        + definitions
        + f'<g transform="translate({base_x} {base_y}) scale({base_scale})">{base}</g>'
        + "".join(word_paths) + "</svg>\n"
    )
    # Letters start behind B; their final positions lie beyond B's right edge.
    scene = (
        f'<svg class="brand-scene" xmlns="{SVG_NS}" viewBox="0 0 760 500" aria-hidden="true">'
        + definitions + base + "".join(opening_paths[1:]) + opening_paths[0] + "</svg>\n"
    )
    (ROOT / "src/brand-opening.svg").write_text(scene)
    icon_glyph = heavy["B"]
    icon_shift = -icon_glyph["advance"] / 2
    compact = (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 500 500">'
        '<rect width="500" height="500" rx="125" fill="#FFFFFF"/>'
        '<g transform="translate(250 300)">'
        '<rect x="-110" y="-5" width="220" height="130" rx="35" fill="#A7C7E7"/>'
        '<g fill="#FFFFFF" opacity=".6">'
        '<rect x="-60" y="30" width="120" height="10" rx="5"/>'
        '<rect x="-60" y="55" width="90" height="10" rx="5"/>'
        '</g></g><g transform="translate(250 275) rotate(-4)">'
        f'<path d="{icon_glyph["path"]}" transform="translate(10 10) scale(.23) translate({icon_shift} 0)" fill="#F0B948" opacity=".9"/>'
        f'<path d="{icon_glyph["path"]}" transform="scale(.23) translate({icon_shift} 0)" fill="#FFD166"/>'
        '</g></svg>\n'
    )
    (ROOT / "public/brand-header-icon.svg").write_text(compact)
    (ROOT / "src/brand-compact.svg").write_text(compact)
    (ROOT / "src/brand-motion-data.js").write_text(
        "// Generated by scripts/make-brand-motion.py; glyphs are saved as vector paths.\n"
        + "export const brandMotionData = " + json.dumps({
            "glyphs": metadata, "box": box,
            "baseTransform": f"translate({base_x}px, {base_y}px) scale({base_scale})",
            "compactBox": {"x": icon_center - 100, "y": base_y + 445 * base_scale - 170, "width": 200, "height": 200},
        }, indent=2) + ";\n"
    )
    # Preserve the supplied icon's layout while outlining its B for consistency.
    source = ROOT / "public/brand-source.svg"
    if not source.exists():
        raise SystemExit("请先把图标原稿保存为 public/brand-source.svg，再生成图标。")
    icon = ET.fromstring(source.read_text())
    icon.set("width", "512")
    icon.set("height", "512")
    for parent in icon.iter():
        for text in list(parent):
            if text.tag != f"{{{SVG_NS}}}text":
                continue
            character = (text.text or "").strip()
            if character != "B":
                continue
            glyph = heavy["B"]
            size = float(text.get("font-size", "250"))
            shift = -glyph["advance"] / 2
            path = ET.Element(f"{{{SVG_NS}}}path", {
                "d": glyph["path"],
                "transform": f'translate({text.get("x", "0")} {text.get("y", "0")}) scale({size / 1000}) translate({shift} 0)',
                "fill": text.get("fill", "#FFD166"),
            })
            if "opacity" in text.attrib:
                path.set("opacity", text.get("opacity"))
            parent.insert(list(parent).index(text), path)
            parent.remove(text)
    (ROOT / "public/icon.svg").write_bytes(ET.tostring(icon, encoding="utf-8", xml_declaration=False))
    # A quiet watermark uses the same icon, with opacity controlled by CSS.
    (ROOT / "public/brand-symbol.svg").write_bytes(ET.tostring(icon, encoding="utf-8", xml_declaration=False))
    print("Prepared startup scene, rounded wordmark and portable B icon.")


if __name__ == "__main__":
    main()
