#!/usr/bin/env python
# pdf-to-md.py — PyMuPDF 版面解析：PDF → 结构化块 + Markdown
#
# 为什么自己写而不是上 MinerU：
#   · 本地秒级（19 页约 0.4s）、零下载、零 token、离线可用；
#   · 我们真正需要的是「按版面顺序的块 + 归一化 bbox」，好让文本视图能点块回跳 PDF；
#   · 公式/表格的高保真识别交给可选后端（MinerU），这里不做假承诺。
#
# 输出（UTF-8）：
#   <out>/blocks.json  { version, pages:[{ page, width, height, blocks:[...] }] }
#   <out>/full.md      按页顺序拼的 Markdown（标题分级、列表、表格、图注）
#
# 块类型：title(level) / text / list / table / figure / caption
# bbox 全部归一化到 0..1（相对该页宽高），与前端渲染缩放无关。
import json
import re
import statistics
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover
    print(json.dumps({"error": "fitz-unavailable", "message": str(exc)}))
    sys.exit(3)


def median_size(spans):
    sizes = []
    for span in spans:
        text = span.get("text", "")
        if text.strip():
            sizes.extend([round(span.get("size", 0), 1)] * len(text))
    return statistics.median(sizes) if sizes else 0.0


def is_horizontal(line):
    direction = line.get("dir", (1, 0))
    return abs(direction[1]) < 0.01


def join_lines(lines):
    """合并行；行尾连字符 + 下一行小写 → 直接拼接（PDF 断词）。"""
    out = []
    for line in lines:
        if not is_horizontal(line):
            continue  # 竖排/旋转文字（页边 arXiv 编号之类）不算正文
        parts = [span.get("text", "") for span in line.get("spans", [])]
        text = "".join(parts).strip()
        if not text:
            continue
        if out and out[-1].endswith("-") and text[:1].islower():
            out[-1] = out[-1][:-1] + text
        else:
            out.append(text)
    return out


def is_bullet(text):
    stripped = text.lstrip()
    for mark in ("•", "·", "◦", "▪", "-", "–", "*", "‣"):
        if stripped.startswith(mark + " "):
            return True
    return False


def looks_like_caption(text):
    low = text.strip().lower()
    return low.startswith(("figure ", "fig.", "table ", "图 ", "表 ", "algorithm "))


def heading_level(size, body, bold):
    if body <= 0:
        return 0
    ratio = size / body
    if ratio >= 1.75:
        return 1
    if ratio >= 1.45:
        return 2
    if ratio >= 1.18:
        return 3
    if ratio >= 1.08 and bold:
        return 4
    return 0


def table_markdown(rows):
    rows = [[(cell or "").replace("\n", " ").strip() for cell in row] for row in rows if row]
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    head = rows[0]
    body = rows[1:]
    lines = ["| " + " | ".join(head) + " |", "| " + " | ".join(["---"] * width) + " |"]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


EQUATION_NUMBER = re.compile(r"^\(\d{1,3}[a-z]?\)$", re.I)
MATH_FONT = re.compile(r"^(?:CM(?:MI|SY|EX|R|B)|LM(?:Math|Roman)|MSAM|MSBM|DSROM|STIX.*Math|CambriaMath)", re.I)


def numbered_equations(raw, regions, body_size):
    lines = []
    for block in raw["blocks"]:
        for line in block.get("lines", []):
            if not is_horizontal(line):
                continue
            spans = [span for span in line["spans"] if span["text"].strip()]
            text = "".join(span["text"] for span in spans).strip()
            box = fitz.Rect(line["bbox"])
            if not text or any((box & region).get_area() > box.get_area() * 0.55
                               for _, region, _ in regions):
                continue
            math = any(MATH_FONT.match(span["font"]) for span in spans)
            prose = any(not MATH_FONT.match(span["font"]) and
                        len(re.findall(r"[A-Za-z]{2,}", span["text"])) >= 2 for span in spans)
            lines.append((line, box, text, math, prose))

    equations = []
    assigned = set()
    window = max(20, body_size * 3.3)
    for marker, anchor, number, _, _ in lines:
        if not EQUATION_NUMBER.fullmatch(number) or id(marker) in assigned:
            continue
        y = (anchor.y0 + anchor.y1) / 2
        # Infer the column from prose lines ending near the equation number.
        column = [box for _, box, _, _, prose in lines
                  if prose and abs(box.x1 - anchor.x1) <= 8 and box.width >= 85]
        if not column:
            continue
        left = min(box.x0 for box in column)
        prose_rows = [box for _, box, _, _, prose in lines
                      if prose and box.x0 >= left - 2 and box.x1 <= anchor.x1 + 4]
        top = max((box.y1 for box in prose_rows if box.y1 < y - 2), default=y - window)
        bottom = min((box.y0 for box in prose_rows if box.y0 > y + 2), default=y + window)
        for _, box, text, _, _ in lines:
            if abs(box.x1 - anchor.x1) > 5 or not EQUATION_NUMBER.fullmatch(text):
                continue
            neighbor = (box.y0 + box.y1) / 2
            if neighbor < y:
                top = max(top, (y + neighbor) / 2)
            elif neighbor > y:
                bottom = min(bottom, (y + neighbor) / 2)
        fragments = []
        for line, box, _, math, prose in lines:
            center = (box.y0 + box.y1) / 2
            if (id(line) not in assigned and math and not prose and box.x0 >= left - 2
                    and box.x1 <= anchor.x1 + 4 and max(top, y - window) <= center <= min(bottom, y + window)):
                fragments.append((line, box))
        if not fragments:
            continue
        region = fitz.Rect(anchor)
        for line, box in fragments:
            assigned.add(id(line))
            region |= box
        assigned.add(id(marker))
        equations.append(("equation", fitz.Rect(region.x0 - 2, region.y0 - 1.5,
                                                region.x1 + 2, region.y1 + 1.5), number))
    return equations, assigned


def parse_page(page, page_no):
    width = float(page.rect.width) or 1.0
    height = float(page.rect.height) or 1.0
    raw = page.get_text("dict")

    spans_all = []
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans_all.append(line.get("spans", []))
    body_size = median_size([s for group in spans_all for s in group])

    # Caption-linked graphics can contain text, vector paths and raster images.
    # Capture the whole region before looking for tables inside the remaining page.
    drawings = page.get_drawings()
    graphics = [r for r in page.cluster_drawings(drawings=drawings, x_tolerance=6, y_tolerance=6)
                if r.width >= 45 and r.height >= 18]
    for block in raw.get("blocks", []):
        if block.get("type") == 1:
            r = fitz.Rect(block["bbox"])
            if r.width >= 20 and r.height >= 15 and r.get_area() < width * height * 0.9:
                graphics.append(r)

    regions = []
    for block in raw.get("blocks", []):
        text = " ".join(join_lines(block.get("lines", []))).strip().lower()
        caption = fitz.Rect(block["bbox"])
        if text.startswith(("table ", "表 ")):
            rules = sorted((d["rect"] for d in drawings if d["rect"].height < 2
                            and d["rect"].y1 < caption.y0
                            and min(d["rect"].x1, caption.x1) - max(d["rect"].x0, caption.x0) >= caption.width * 0.65),
                           key=lambda r: r.y0, reverse=True)
            if rules and caption.y0 - rules[0].y1 < 26:
                bottom = rules[0]
                top = bottom
                for r in rules[1:]:
                    if bottom.y0 - r.y0 > 300 or top.y0 - r.y0 > 190:
                        break
                    if abs(r.x0 - bottom.x0) < 4 and abs(r.x1 - bottom.x1) < 4:
                        top = r
                if bottom.y0 - top.y0 > 12:
                    regions.append(("table", fitz.Rect(top.x0 - 3, top.y0 - 3, bottom.x1 + 3,
                                                      min(caption.y0, bottom.y1 + 4)), ""))
            continue
        if not text.startswith(("figure ", "fig.", "图 ")):
            continue
        figure_parts = graphics
        if any(r.y0 < caption.y0 < r.y1 and (r.x0 < caption.x1 and r.x1 > caption.x0) for r in graphics):
            # Caption decoration can connect a figure to paths below it. Recluster
            # above the caption so one oversized cluster cannot hide the figure.
            above = [drawing for drawing in drawings if drawing["rect"].y1 <= caption.y0]
            figure_parts = graphics + [
                r for r in (page.cluster_drawings(drawings=above, x_tolerance=6, y_tolerance=6) if above else [])
                if r.width >= 45 and r.height >= 18
            ]
        candidates = [r for r in figure_parts if r.y1 <= caption.y0 + 3 and
                      min(r.x1, caption.x1) - max(r.x0, caption.x0) >= min(r.width, caption.width) * 0.55]
        candidates.sort(key=lambda r: r.y1, reverse=True)
        if not candidates or caption.y0 - candidates[0].y1 > 54:
            continue
        region = fitz.Rect(candidates[0])
        for r in candidates[1:]:
            if region.y0 - r.y1 > 24:
                break
            region |= r
        # The paths may cover only the center of a composite figure. Include its
        # surrounding labels and raster components within the caption's column.
        corridor = fitz.Rect(min(caption.x0, region.x0) - 4, region.y0 - 18,
                             max(caption.x1, region.x1) + 4, caption.y0 - 2)
        for item in raw["blocks"]:
            boxes = [line["bbox"] for line in item.get("lines", [])] if item["type"] == 0 else [item["bbox"]]
            for bounds in boxes:
                part = fitz.Rect(bounds)
                if not part.is_empty and part in corridor and part.y1 >= region.y0 - 12:
                    region |= part
        region = fitz.Rect(region.x0 - 5, region.y0 - 5, region.x1 + 5, min(caption.y0, region.y1 + 8))
        regions.append(("figure", region, ""))

    def covered(box, regions):
        return any((box & r).get_area() > 0.55 * box.get_area() for _, r, _ in regions)

    try:
        # Ignore drawn figure grids entirely and ignore decorative filled boxes.
        paths = [d for d in drawings if not any(d["rect"] in r for _, r, _ in regions)]
        for table in page.find_tables(strategy="lines_strict", paths=paths).tables:
            bounds = fitz.Rect(table.bbox)
            if table.row_count < 2 or table.col_count < 2 or covered(bounds, regions):
                continue
            regions.append(("table", bounds, table_markdown(table.extract())))
    except Exception:
        pass

    def normalize(rect):
        rect = rect * page.rotation_matrix if page.rotation else rect
        return [round(max(0.0, min(1.0, value / size)), 5)
                for value, size in zip(rect, (width, height, width, height))]

    equations, equation_lines = numbered_equations(raw, regions, body_size)
    original_blocks = raw["blocks"]
    if equation_lines:
        updated = []
        for block in original_blocks:
            lines = block.get("lines", [])
            if not any(id(line) in equation_lines for line in lines):
                updated.append(block)
                continue
            group = []
            for line in [*lines, None]:
                if line is not None and id(line) not in equation_lines:
                    group.append(line)
                    continue
                if group:
                    bounds = fitz.Rect(group[0]["bbox"])
                    for member in group[1:]:
                        bounds |= fitz.Rect(member["bbox"])
                    updated.append({**block, "lines": group, "bbox": bounds})
                    group = []
        original_blocks = updated
    blocks = [{"type": kind, "bbox": normalize(rect), "text": text, "crop": True}
              for kind, rect, text in [*regions, *equations]]
    for block in original_blocks:
        bbox = fitz.Rect(block.get("bbox", (0, 0, 0, 0)))
        if bbox.is_empty or covered(bbox, regions):
            continue
        norm = normalize(bbox)
        if block.get("type") != 0:
            if bbox.width >= 20 and bbox.height >= 15 and bbox.get_area() < width * height * 0.9:
                blocks.append({"type": "figure", "bbox": norm, "text": "", "crop": True})
            continue

        lines = block.get("lines", [])
        texts = join_lines(lines)
        if not texts:
            continue
        text = "\n".join(texts)

        sizes = []
        bold = False
        for line in lines:
            for span in line.get("spans", []):
                if span.get("text", "").strip():
                    sizes.append(span.get("size", 0))
                    if int(span.get("flags", 0)) & 16:
                        bold = True
        size = statistics.median(sizes) if sizes else body_size
        level = heading_level(size, body_size, bold)

        if level:
            kind = {"type": "title", "level": level}
        elif all(is_bullet(t) for t in texts) and len(texts) > 0:
            kind = {"type": "list"}
        elif looks_like_caption(text):
            kind = {"type": "caption"}
        else:
            kind = {"type": "text"}

        if kind["type"] != "list":
            text = " ".join(t.strip() for t in texts)
        entry = {"bbox": norm, "text": text}
        entry.update(kind)
        blocks.append(entry)

    blocks.sort(key=lambda b: (round(b["bbox"][1], 2), round(b["bbox"][0], 3)))
    left = [b for b in blocks if b["type"] == "text" and b["bbox"][2] <= 0.51
            and b["bbox"][2] - b["bbox"][0] > 0.29]
    right = [b for b in blocks if b["type"] == "text" and b["bbox"][0] >= 0.49
             and b["bbox"][2] - b["bbox"][0] > 0.29]
    if len(left) >= 2 and len(right) >= 2:
        ordered, band = [], []
        for block in blocks:
            x0, _, x1, _ = block["bbox"]
            if x0 < 0.40 and x1 > 0.60:
                ordered.extend(sorted(band, key=lambda item: item["bbox"][0] >= 0.49))
                band.clear()
                ordered.append(block)
            else:
                band.append(block)
        blocks = ordered + sorted(band, key=lambda item: item["bbox"][0] >= 0.49)

    # 形如 "1" / "2.3" 的单独编号块，与同一基线附近的下一个标题块合并（"1" + "Introduction"）
    merged = []
    for block in blocks:
        prev = merged[-1] if merged else None
        same_row = prev and abs(prev["bbox"][1] - block["bbox"][1]) < 0.012
        prev_is_number = prev and prev["type"] in ("title", "text") and prev.get("text", "").strip().replace(".", "").isdigit()
        if same_row and prev_is_number and block["type"] in ("title", "text"):
            prev["text"] = f'{prev["text"].strip()} {block.get("text", "").strip()}'
            if block["type"] == "title":
                prev["type"] = "title"
                prev["level"] = min(prev.get("level", 3), block.get("level", 3))
            prev["bbox"] = [
                min(prev["bbox"][0], block["bbox"][0]),
                min(prev["bbox"][1], block["bbox"][1]),
                max(prev["bbox"][2], block["bbox"][2]),
                max(prev["bbox"][3], block["bbox"][3]),
            ]
            continue
        merged.append(block)
    blocks = merged
    for index, block in enumerate(blocks):
        block["id"] = f"p{page_no}-{index}"

    return {"page": page_no, "width": width, "height": height, "blocks": blocks}


def apply_bookmarks(pages, bookmarks):
    authoritative = len(bookmarks) >= 2
    outline = []
    for page in pages:
        for block in page["blocks"]:
            if block["type"] != "title":
                continue
            if page["page"] == 1 and block is page["blocks"][0]:
                block["role"] = "document-title"
            elif page["page"] == 1 and len(block["text"]) > 140 and "," in block["text"]:
                block.update(type="text", role="byline")
            elif authoritative:
                block["type"] = "text"
    if not authoritative:
        return []
    for level, title, number in bookmarks:
        if not 1 <= number <= len(pages) or not title.strip():
            continue
        page = pages[number - 1]
        blocks = page["blocks"]
        pattern = re.compile(r"^\s*" + r"\s+".join(re.escape(word) for word in title.split()) + r"(?=\s|$)", re.I)
        matched = next(((i, pattern.match(block["text"])) for i, block in enumerate(blocks)
                        if block["type"] == "text" and pattern.match(block["text"])), None)
        target = None
        if matched:
            i, match = matched
            target = blocks[i]
            rest = target["text"][match.end():].strip()
            if rest:
                left, top, right, bottom = target["bbox"]
                split = min(bottom, top + 13 / page["height"])
                heading = {**target, "id": target["id"] + "-heading", "bbox": [left, top, right, split]}
                target.update(text=rest, bbox=[left, split, right, bottom])
                blocks.insert(i, heading)
                target = heading
            target.update(type="title", level=level, text=title)
        elif title.lower() == "abstract":
            target = next((b for b in blocks if b["type"] == "text" and not b.get("role") and len(b["text"]) > 150), None)
        outline.append({"title": title, "level": level, "page": number, "blockId": target["id"] if target else None})
    return outline


def to_markdown(pages, title):
    out = []
    if title:
        out.append(f"# {title}\n")
    for page in pages:
        out.append(f"<!-- page {page['page']} -->\n")
        for block in page["blocks"]:
            kind = block["type"]
            text = block.get("text", "").strip()
            if kind == "title":
                level = 2 if block.get("level", 3) <= 1 else 3  # 文档标题占 #：大标题→##，小节→###
                out.append(f"{'#' * level} {text}\n")
            elif kind == "table":
                out.append((block.get("markdown") or text) + "\n")
            elif kind == "list":
                for line in text.split("\n"):
                    out.append(f"- {line.lstrip('•·◦▪-–*‣ ').strip()}")
                out.append("")
            elif kind == "caption":
                out.append(f"*{text}*\n")
            elif kind == "equation":
                out.append(f"[公式 {text}，见原 PDF 第 {page['page']} 页]\n")
            elif kind == "figure":
                continue
            else:
                out.append(text + "\n")
    return "\n".join(out)


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage", "message": "pdf-to-md.py <pdf> <outdir> [title]"}))
        return 2
    pdf_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    title = sys.argv[3] if len(sys.argv) > 3 else ""
    out_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    try:
        pages = [parse_page(doc[i], i + 1) for i in range(doc.page_count)]
        outline = apply_bookmarks(pages, doc.get_toc())
        meta_title = title or (doc.metadata or {}).get("title", "") or pdf_path.stem
    finally:
        doc.close()

    result = {
        "version": 6,
        "outline": outline,
        "title": meta_title,
        "pageCount": len(pages),
        "pages": pages,
    }
    (out_dir / "full.md").write_text(to_markdown(pages, meta_title), encoding="utf-8")
    temporary = out_dir / "blocks.json.tmp"
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    temporary.replace(out_dir / "blocks.json")
    print(json.dumps({"ok": True, "pages": len(pages), "blocks": sum(len(p["blocks"]) for p in pages)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
