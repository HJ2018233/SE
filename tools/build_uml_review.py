#!/usr/bin/env python3
"""Build an image-only A3 review PDF without adding files to the submission set."""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess


def diagram_sort_key(image):
    group = image.stem.split("-", 1)[0]
    source = image.with_suffix(".puml")
    text = source.read_text(encoding="utf-8") if source.exists() else ""
    match = re.search(r"^title\s+.*?[（(]([0-9一二三四五六七八九十]+)[）)]", text, re.M)
    if not match:
        return group, 0, image.stem
    ordinal = match.group(1)
    digits = dict(zip("一二三四五六七八九", range(1, 10)))
    if ordinal.isdecimal():
        number = int(ordinal)
    elif "十" in ordinal:
        tens, units = ordinal.split("十")
        number = digits.get(tens, 1) * 10 + digits.get(units, 0)
    else:
        number = digits[ordinal]
    return group, number, image.stem


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    images = sorted(args.directory.resolve().glob("*.png"), key=diagram_sort_key)
    if not images:
        parser.error("No PNG diagrams found")
    output = args.output.resolve()
    build_dir = output.parent / "review-build"
    build_dir.mkdir(parents=True, exist_ok=True)
    document = [r"\documentclass{article}", r"\usepackage[a3paper,margin=12mm]{geometry}",
                r"\usepackage{graphicx}", r"\usepackage{pdflscape}",
                r"\pagestyle{empty}", r"\setlength{\parindent}{0pt}", r"\begin{document}"]
    for image in images:
        width, height = struct.unpack(">II", image.read_bytes()[16:24])
        landscape = width > height
        if landscape:
            document.append(r"\begin{landscape}")
        document.append(r"\noindent\includegraphics[width=\linewidth,height=0.96\textheight,keepaspectratio]{\detokenize{" + str(image) + "}}")
        document.append(r"\end{landscape}" if landscape else r"\clearpage")
    document.append(r"\end{document}")
    tex = build_dir / "uml-review.tex"
    tex.write_text("\n".join(document) + "\n", encoding="utf-8")
    build_env = dict(os.environ, TMPDIR=str(build_dir), TEXMFVAR=str(build_dir / "texmf-var"),
                     TEXMFCONFIG=str(build_dir / "texmf-config"))
    result = subprocess.run(["xelatex", "-interaction=nonstopmode", "-halt-on-error", tex.name],
                            cwd=build_dir, env=build_env, capture_output=True, text=True)
    (build_dir / "compile-output.txt").write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"PDF build failed; see {build_dir / 'compile-output.txt'}")
    if "Overfull" in (build_dir / "uml-review.log").read_text(encoding="utf-8"):
        raise RuntimeError("PDF contains overfull boxes; inspect the layout")
    shutil.copyfile(build_dir / "uml-review.pdf", output)
    order = [{"page": page, "file": image.name} for page, image in enumerate(images, 1)]
    output.with_suffix(".order.json").write_text(json.dumps(order, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)
    print(f"Expected pages: {len(images)}")


if __name__ == "__main__":
    main()
