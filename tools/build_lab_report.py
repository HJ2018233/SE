#!/usr/bin/env python3
"""Build concise Lab2 prose; reference diagrams in the submission folders."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import xml.etree.ElementTree as ET


def run(command, directory, name):
    env = dict(os.environ, TMPDIR=str(directory), TEXMFVAR=str(directory / 'texmf-var'),
               TEXMFCONFIG=str(directory / 'texmf-config'))
    result = subprocess.run(command, cwd=directory, env=env, capture_output=True, text=True)
    (directory / name).write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed; see {directory / name}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    root = parser.parse_args().root.resolve()
    build = root / 'Lab2/.build/report-concise'
    build.mkdir(parents=True, exist_ok=True)
    run(['pandoc', str(root / 'Lab2/过程记录/报告正文.md'),
         '--from=markdown+tex_math_dollars+raw_tex', '--to=latex', '--wrap=none',
         '-o', str(build / 'body.tex')], build, 'pandoc-output.txt')
    document = r"""\documentclass[UTF8,fontset=none,a4paper,11pt]{ctexart}
\usepackage[a4paper,margin=20mm,headheight=15pt]{geometry}
\usepackage{fontspec,xcolor,amsmath,amssymb,booktabs,longtable,array,calc}
\usepackage{enumitem,xurl,hyperref,fancyhdr}
\setmainfont{TeX Gyre Termes}
\setsansfont{TeX Gyre Heros}
\setmonofont{DejaVu Sans Mono}[Scale=MatchLowercase]
\setCJKmainfont{Noto Serif CJK SC}
\setCJKsansfont{Noto Sans CJK SC}
\setCJKmonofont{Noto Sans CJK SC}
\definecolor{brand}{HTML}{0F6CBD}
\definecolor{ink}{HTML}{24364B}
\definecolor{muted}{HTML}{526171}
\hypersetup{colorlinks=true,urlcolor=brand,linkcolor=ink,unicode=true,
pdftitle={实验二：软件设计与建模——酒店预订系统},pdfauthor={黄佳 241830144}}
\urlstyle{same}
\setlength{\parindent}{2em}
\setlength{\parskip}{.22em}
\setlength{\emergencystretch}{3em}
\setlist{itemsep=.2em,topsep=.3em,leftmargin=1.6em}
\renewcommand{\arraystretch}{1.1}
\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}
\widowpenalty=10000\clubpenalty=10000\displaywidowpenalty=10000
\ctexset{section={format=\large\sffamily\bfseries\color{ink},beforeskip=1em,afterskip=.6em},
subsection={format=\normalsize\sffamily\bfseries\color{ink},beforeskip=.8em,afterskip=.5em}}
\setcounter{secnumdepth}{0}
\fancyhf{}
\fancyhead[L]{\small\sffamily\color{muted}酒店预订系统}
\fancyhead[R]{\small\sffamily\color{muted}实验二：软件设计与建模}
\fancyfoot[C]{\small\thepage}
\renewcommand{\headrulewidth}{.3pt}
\pagestyle{fancy}
\begin{document}
{\centering\sffamily\bfseries\fontsize{20}{27}\selectfont 实验二：软件设计与建模\par}
\vspace{2mm}
{\centering\sffamily 酒店预订系统\quad 黄佳\quad 241830144\quad 2026年11月13日\par}
\vspace{2mm}
\input{body.tex}
\end{document}
"""
    (build / 'main.tex').write_text(document)
    for n in (1, 2):
        run(['xelatex', '-interaction=nonstopmode', '-halt-on-error', 'main.tex'],
            build, f'compile-{n}.txt')
    log = (build / 'main.log').read_text()
    warnings = [line for line in log.splitlines() if 'Overfull' in line or 'Missing character:' in line]
    if warnings:
        raise RuntimeError(f'Layout/font warnings: {warnings}')
    output = root / 'Lab2/实验报告.pdf'
    shutil.copyfile(build / 'main.pdf', output)
    subprocess.run(['pdftotext', '-bbox', str(output), str(build / 'bbox.html')], check=True)
    ns = {'h': 'http://www.w3.org/1999/xhtml'}
    pages, outside = [], []
    for number, page in enumerate(ET.parse(build / 'bbox.html').findall('.//h:page', ns), 1):
        width, height = float(page.attrib['width']), float(page.attrib['height'])
        words = page.findall('.//h:word', ns)
        for word in words:
            box = [float(word.attrib[k]) for k in ('xMin', 'yMin', 'xMax', 'yMax')]
            if box[0] < 10 or box[1] < 10 or box[2] > width-10 or box[3] > height-10:
                outside.append({'page': number, 'text': word.text, 'box': box})
        pages.append({'page': number, 'width_pt': width, 'height_pt': height, 'words': len(words)})
    result = {'output': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
              'pages': pages, 'embedded_diagrams': 0, 'embedded_ui_screenshots': 0,
              'overfull_or_missing': warnings, 'out_of_bounds_words': outside,
              'organization': 'PDF正文引用UML与UI界面目录；整个ZIP共同构成报告。'}
    (root / 'Lab2/过程记录/报告/PDF核验.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    if outside:
        raise RuntimeError(f'Out of bounds: {outside[:5]}')
    print(f'Built {output}; {len(pages)} pages, {output.stat().st_size/1024:.1f} KiB')


if __name__ == '__main__':
    main()
