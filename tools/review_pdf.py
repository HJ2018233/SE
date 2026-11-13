#!/usr/bin/env python3
"""Render all PDF pages and numbered contact sheets for visual review."""
import argparse
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageOps, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pdftoppm", "-r", "40", "-png", str(args.pdf.resolve()), str(output / "page")], check=True)
    images = sorted(output.glob("page-*.png"))
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    sheets = []
    for start in range(0, len(images), 12):
        selected = images[start:start+12]
        sheet = Image.new("RGB", (1440, 960), "#e9edf1")
        draw = ImageDraw.Draw(sheet)
        for i, path in enumerate(selected):
            x, y = (i % 4) * 360, (i // 4) * 320
            draw.rectangle((x+8,y+8,x+352,y+312), fill="white")
            draw.text((x+18,y+14), f"Page {start+i+1}", font=font, fill="#24364b")
            with Image.open(path) as image:
                preview = ImageOps.contain(image.convert("RGB"), (330,264))
            sheet.paste(preview, (x+15+(330-preview.width)//2,y+42))
        path = output / f"contact-{start//12+1:02}.png"
        sheet.save(path)
        sheets.append(str(path))
    (output / "review-index.json").write_text(json.dumps({"pages":len(images),"contact_sheets":sheets},indent=2))
    print(json.dumps({"pages":len(images),"sheets":sheets}))


if __name__ == "__main__":
    main()
