# 本学期共用绘图工具

这些工具和第三方文件是项目公共资产，在根目录维护，按 `.git/info/exclude` 保留为本地文件。课程交付图中的 PlantUML 源文件已内嵌样式，可独立渲染。

- `vendor/plantuml-1.2026.9.jar`：下载自 [PlantUML 官方发布](https://github.com/plantuml/plantuml/releases/download/v1.2026.9/plantuml-1.2026.9.jar)，GPL 版本；[官方许可说明](https://plantuml.com/download)。SHA-256：`aa4a1d06f8911c4b842beff4828dd955be431692b631a312d04c0e9fab9581de`。
- `uml-style.puml`：公共样式。各次交付导出时内嵌一份，不要求提交外部依赖；仅适用特定图类的指令放在对应源图内。
- `render_uml.py`：检查单图、自包含源文件和 PlantUML 语法，导出 PNG；可生成本地 SVG 与哈希清单。
- `build_uml_review.py`：把同目录 PNG 生成 A3 审阅图集，同类图按源文件标题中的编号排序，并输出页序清单；按图形横竖比例旋转页面，拒绝存在 Overfull 的构建。图集是审阅材料，不是课程实验报告。

```sh
python3 tools/render_uml.py Lab2/UML --preview-dir Lab2/.build/uml
python3 tools/build_uml_review.py Lab2/UML Lab2/.build/uml/UML审阅图集.pdf
```

需要 Java、Graphviz，以及审阅图集所需的 XeLaTeX/graphicx/pdflscape。这里只下载了项目本地 PlantUML，没有修改系统绘图工具。
