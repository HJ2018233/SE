#!/usr/bin/env python3
"""Render standalone PlantUML deliverables and optional local SVG previews."""

import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--preview-dir", type=Path)
    parser.add_argument("--jar", type=Path, default=Path(__file__).parent / "vendor/plantuml-1.2026.9.jar")
    args = parser.parse_args()
    sources = sorted(args.directory.resolve().glob("*.puml"))
    if not sources:
        parser.error("No .puml files found")
    for source in sources:
        text = source.read_text(encoding="utf-8")
        if text.count("@startuml") != 1 or text.count("@enduml") != 1:
            raise ValueError(f"Expected one diagram in {source}")
        if any(line.lstrip().startswith("!include") for line in text.splitlines()):
            raise ValueError(f"Submission source must be standalone: {source}")
    command = ["java", "-XX:-UsePerfData", "-Djava.awt.headless=true", "-DPLANTUML_LIMIT_SIZE=16384",
               "-jar", str(args.jar.resolve()), "-charset", "UTF-8", "-failfast2"]
    subprocess.run(command + ["-checkonly"] + [str(p) for p in sources], check=True)
    subprocess.run(command + ["-tpng"] + [str(p) for p in sources], check=True)
    if args.preview_dir:
        args.preview_dir = args.preview_dir.resolve()
        args.preview_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(command + ["-tsvg", "-o", str(args.preview_dir)] + [str(p) for p in sources], check=True)
    manifest = []
    for source in sources:
        png = source.with_suffix(".png")
        data = png.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"Not a PNG: {png}")
        width, height = struct.unpack(">II", data[16:24])
        if width < 100 or height < 100 or max(width, height) >= 16384:
            raise ValueError(f"Unexpected or limited image size: {png}: {width}x{height}")
        entry = {"name": source.stem, "width": width, "height": height,
                 "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                 "png_sha256": hashlib.sha256(data).hexdigest()}
        manifest.append(entry)
        print(f"{source.stem}: {width} x {height}")
    if args.preview_dir:
        (args.preview_dir / "render.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
