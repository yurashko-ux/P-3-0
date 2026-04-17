#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF посвідчень про відрядження: підстановка даних у готовий шаблон-PDF (PyMuPDF).

Реквізити для заміни не зберігаються в коді — лише у локальному JSON (--replacements),
щоб не потрапляли в git. Див. scripts/vidryadzhennya.replacements.example.json та docs/VIDRYADZHENNYA_PDF_Z_SHABLONU.md

Залежність: pip install pymupdf
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

DEFAULT_FONT_REG = Path("/System/Library/Fonts/Supplemental/Times New Roman.ttf")
DEFAULT_FONT_BOLD = Path("/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf")


def _span_is_bold(span: dict) -> bool:
    fn = span.get("font") or ""
    if "Bold" in fn or "bold" in fn.lower():
        return True
    fl = int(span.get("flags") or 0)
    return bool(fl & (1 << 4))


def _collect_spans_for_phrase(page: fitz.Page, phrase: str) -> list[dict]:
    phrase = phrase.strip() or phrase
    found: list[dict] = []
    doc_dict = page.get_text("dict")
    for block in doc_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text") or ""
                if phrase not in text:
                    continue
                bbox = span.get("bbox")
                if not bbox:
                    continue
                origin = span.get("origin")
                if origin is None:
                    r = fitz.Rect(bbox)
                    origin = (r.x0, r.y1)
                found.append(
                    {
                        "rect": fitz.Rect(bbox),
                        "origin": fitz.Point(origin),
                        "size": float(span.get("size") or 12.0),
                        "bold": _span_is_bold(span),
                    }
                )
    return found


def _batch_vertical_replace(
    page: fitz.Page,
    pairs: list[tuple[str, str]],
    font_regular: str,
    font_bold: str,
    font_path_reg: Path,
    font_path_bold: Path,
) -> None:
    inserts: list[tuple[str, fitz.Point, float, bool]] = []
    rects_to_redact: list[fitz.Rect] = []

    for old, new in pairs:
        spans = _collect_spans_for_phrase(page, old)
        if not spans:
            print(
                f"[попередження] не знайдено span для: {old[:48]}… (стор. {page.number + 1})",
                file=sys.stderr,
            )
            continue
        for sp in spans:
            rects_to_redact.append(sp["rect"])
            inserts.append((new, sp["origin"], sp["size"], sp["bold"]))

    for r in rects_to_redact:
        page.add_redact_annot(r)
    if not inserts:
        return

    page.apply_redactions()

    page.insert_font(font_regular, fontfile=str(font_path_reg))
    page.insert_font(font_bold, fontfile=str(font_path_bold))

    for new, origin, size, bold in inserts:
        fname = font_bold if bold else font_regular
        page.insert_text(
            origin,
            new,
            fontname=fname,
            fontsize=size,
            rotate=90,
            color=(0, 0, 0),
        )


def _load_replacements(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in list(data.keys()):
        if key.startswith("_"):
            del data[key]
    for req in ("BACK", "DATE", "ORD"):
        if req not in data:
            raise ValueError(f"У JSON бракує ключа «{req}»")
        block = data[req]
        if not isinstance(block, dict) or "old" not in block or "new" not in block:
            raise ValueError(f"Ключ «{req}» має бути об'єктом з полями old та new")
    return data


def build_pdf(
    template_path: Path,
    output_path: Path,
    replacements: dict[str, Any],
    font_path_reg: Path,
    font_path_bold: Path,
) -> None:
    if not font_path_reg.exists():
        raise FileNotFoundError(f"Не знайдено шрифт: {font_path_reg}")
    if not font_path_bold.exists():
        raise FileNotFoundError(f"Не знайдено шрифт: {font_path_bold}")

    back = (replacements["BACK"]["old"], replacements["BACK"]["new"])
    date = (replacements["DATE"]["old"], replacements["DATE"]["new"])
    ord_ = (replacements["ORD"]["old"], replacements["ORD"]["new"])
    name_first: tuple[str, str] | None = None
    if "NAME_FIRST" in replacements and replacements["NAME_FIRST"] is not None:
        nf = replacements["NAME_FIRST"]
        if isinstance(nf, dict) and "old" in nf and "new" in nf:
            name_first = (nf["old"], nf["new"])

    doc = fitz.open(template_path)
    if doc.page_count >= 1:
        last = doc[doc.page_count - 1]
        if not last.get_text().strip():
            doc.delete_page(doc.page_count - 1)

    fr, fb = "tnr", "tnrb"

    p0 = doc[0]
    _batch_vertical_replace(p0, [back], fr, fb, font_path_reg, font_path_bold)

    cert_pairs: list[tuple[str, str]] = [date, ord_]

    for i in range(1, doc.page_count):
        page = doc[i]
        pairs = list(cert_pairs)
        if i == 1 and name_first is not None:
            pairs.insert(0, name_first)
        _batch_vertical_replace(page, pairs, fr, fb, font_path_reg, font_path_bold)

    doc.save(output_path, garbage=4, deflate=True, clean=True)
    doc.close()


def main() -> None:
    ap = argparse.ArgumentParser(
        description="PDF відряджень: шаблон PDF + локальний JSON підстановок (без ПІБ у git)"
    )
    ap.add_argument("--template", type=Path, required=True, help="Шлях до PDF-шаблону")
    ap.add_argument("--output", type=Path, required=True, help="Куди зберегти PDF")
    ap.add_argument(
        "--replacements",
        type=Path,
        required=True,
        help="Локальний JSON (не комітити) — див. vidryadzhennya.replacements.example.json",
    )
    ap.add_argument(
        "--font-regular",
        type=Path,
        default=DEFAULT_FONT_REG,
        help="TTF Times New Roman (звичайний)",
    )
    ap.add_argument(
        "--font-bold",
        type=Path,
        default=DEFAULT_FONT_BOLD,
        help="TTF Times New Roman Bold",
    )
    args = ap.parse_args()

    if not args.template.exists():
        raise SystemExit(f"Немає файлу шаблону: {args.template}")
    if not args.replacements.exists():
        raise SystemExit(f"Немає файлу підстановок: {args.replacements}")

    reps = _load_replacements(args.replacements)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    build_pdf(
        args.template,
        args.output,
        reps,
        args.font_regular,
        args.font_bold,
    )
    print(f"Збережено: {args.output}")


if __name__ == "__main__":
    main()
