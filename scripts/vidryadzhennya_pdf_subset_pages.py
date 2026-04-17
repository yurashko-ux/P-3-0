#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обрізає PDF-шаблон посвідчень до заданих сторінок і підставляє дані по кожній сторінці
(ім’я + блок посади між мітками після ПІБ і до «відрядженому до»), плюс глобальні пари (дата, підстава, тощо).

Усі чутливі рядки — у локальному JSON (--config), не в коді репозиторію.

Формат config (UTF-8 JSON):
{
  "template": "/abs/шаблон.pdf",
  "output": "/abs/результат.pdf",
  "keep_original_page_indices": [0, 1, 2, 3, 4, 5],
  "font_regular": "/optional/path/Times New Roman.ttf",
  "font_bold": "/optional/path/Times New Roman Bold.ttf",
  "global_text_pairs": [["старий підрядок", "новий"], ...],
  "per_page": [
    {
      "original_page_index": 1,
      "name_search_substring": "унікальний фрагмент ПІБ у шаблоні",
      "name_new_with_spaces": " рядок ПІБ як у span після «Видано» ",
      "position_new_one_line": "повний текст посади одним рядком для поділу на частини"
    },
    {
      "_comment": "Два різні ПІБ на одному аркуші (ліва/права колонка), як у шаблоні з двома однаковими плейсхолдерами:",
      "original_page_index": 6,
      "name_search_substring": "ДМИТРІВУ",
      "name_new_with_spaces": [" лейтенанту … ", " солдату … "],
      "position_new_one_line": ["… посада перша …", "… посада друга …"],
      "page_local_text_pairs": [["Проходження Навчання (ВОС-100)", "Супровід особового складу"]]
    }
  ]
}

Залежність: pip install pymupdf
"""

from __future__ import annotations

import argparse
import json
import math
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


def _spans_in_order(page: fitz.Page) -> list[dict]:
    out: list[dict] = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                out.append(span)
    return out


def _collect_spans_for_phrase(page: fitz.Page, phrase: str) -> list[dict]:
    phrase = phrase.strip() or phrase
    found: list[dict] = []
    for span in _spans_in_order(page):
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


def _job_spans_after_name(span_list: list[dict], name_sub: str) -> list[dict]:
    """Повертає span-и «посади» після рядка ПІБ до «відрядженому до» (для одного примірника на сторінці)."""
    idxs = [i for i, s in enumerate(span_list) if name_sub in (s.get("text") or "")]
    jobs: list[dict] = []
    for idx in idxs:
        row: list[dict] = []
        j = idx + 1
        while j < len(span_list):
            t = span_list[j].get("text") or ""
            if "(пункти призначень)" in t:
                break
            if "відрядженому до" in t:
                break
            st = t.strip()
            if st and "(військове звання" not in t and "(посада" not in t and "Видано" not in t:
                row.append(span_list[j])
            j += 1
        jobs.append(row)
    return jobs


def _effective_line_count(word_count: int, max_lines: int) -> int:
    """
    Скільки рядків використати для посади: коротший текст — менше рядків (компактніше поле).
    Орієнтир ~4 слова на рядок, не більше max_lines.
    """
    if max_lines <= 0:
        return 0
    if word_count <= 0:
        return 1
    est = max(1, math.ceil(word_count / 4.0))
    return min(max_lines, est)


def _split_position_balanced_words(new_one_line: str, parts: int) -> list[str]:
    """
    Поділ тексту посади на parts рядків **по словах**, з рівномірним навантаженням по довжині рядків.
    Порядок слів зберігається (послідовне заповнення рядків). Не рве слова посередині.
    Зайві рядки-«слоти» шаблону залишаються порожніми рядками в списку.
    """
    words = new_one_line.split()
    if parts <= 0:
        return []
    if not words:
        return [""] * parts

    n_use = _effective_line_count(len(words), parts)
    n_use = max(1, min(parts, n_use))

    joined = " ".join(words)
    total_len = len(joined)
    target = total_len / float(n_use) if n_use else total_len

    raw_lines: list[list[str]] = []
    cur: list[str] = []
    cur_len = 0
    for w in words:
        add = len(w) + (1 if cur else 0)
        # Перенос, якщо вже майже досягли цільової довжини й ще можемо відкрити новий рядок
        over = cur and (cur_len + add) > target * 1.2 and len(raw_lines) < n_use - 1
        if over:
            raw_lines.append(cur)
            cur = [w]
            cur_len = len(w)
        else:
            cur.append(w)
            cur_len += add
    if cur:
        raw_lines.append(cur)

    # Якщо залишився зайвий «хвіст» через округлення — злити в останній рядок
    while len(raw_lines) > n_use:
        tail = raw_lines.pop()
        if not raw_lines:
            raw_lines = [tail]
            break
        raw_lines[-1].extend(tail)

    lines: list[str] = []
    for i, parts_w in enumerate(raw_lines):
        line = " ".join(parts_w).strip()
        if i == 0 and line and not line.startswith(" "):
            line = " " + line
        lines.append((line + " ") if line else "")

    while len(lines) < parts:
        lines.append("")
    return lines[:parts]


def _inflate_rect(r: fitz.Rect, pt: float) -> fitz.Rect:
    """Трохи розширити прямокутник редукції, щоб гліфи не обрізались при друці."""
    if pt <= 0:
        return r
    return fitz.Rect(r.x0 - pt, r.y0 - pt, r.x1 + pt, r.y1 + pt)


def _batch_vertical_replace(
    page: fitz.Page,
    pairs: list[tuple[str, str]],
    font_regular: str,
    font_bold: str,
    font_path_reg: Path,
    font_path_bold: Path,
    redact_expand_pt: float = 0.0,
) -> None:
    inserts: list[tuple[str, fitz.Point, float, bool]] = []
    rects_to_redact: list[fitz.Rect] = []

    for old, new in pairs:
        spans = _collect_spans_for_phrase(page, old)
        if not spans:
            print(
                f"[попередження] не знайдено: {old[:40]}… стор.{page.number + 1}",
                file=sys.stderr,
            )
            continue
        for sp in spans:
            rects_to_redact.append(_inflate_rect(sp["rect"], redact_expand_pt))
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


def _batch_vertical_replace_sequential(
    page: fitz.Page,
    pairs: list[tuple[str, str]],
    font_regular: str,
    font_bold: str,
    font_path_reg: Path,
    font_path_bold: Path,
    redact_expand_pt: float = 0.0,
) -> None:
    """
    Як у _batch_vertical_replace, але кожна пара (old, new) застосовується лише до **наступного**
    ще невикористаного span, де old входить у текст (порядок обходу — як у _spans_in_order).
    Потрібно, коли на сторінці два блоки з однаковим плейсхолдером ПІБ (ліва/права колонка).
    """
    spans_flat = _spans_in_order(page)
    used: set[int] = set()
    inserts: list[tuple[str, fitz.Point, float, bool]] = []
    rects_to_redact: list[fitz.Rect] = []

    for old, new in pairs:
        old = old.strip() or old
        hit: int | None = None
        for i, span in enumerate(spans_flat):
            if i in used:
                continue
            text = span.get("text") or ""
            if old in text:
                hit = i
                break
        if hit is None:
            print(
                f"[попередження] sequential: не знайдено наступний span для «{old[:40]}…» стор.{page.number + 1}",
                file=sys.stderr,
            )
            continue
        used.add(hit)
        span = spans_flat[hit]
        bbox = span.get("bbox")
        if not bbox:
            continue
        origin = span.get("origin")
        if origin is None:
            r0 = fitz.Rect(bbox)
            origin = (r0.x0, r0.y1)
        rects_to_redact.append(_inflate_rect(fitz.Rect(bbox), redact_expand_pt))
        inserts.append(
            (
                new,
                fitz.Point(origin),
                float(span.get("size") or 12.0),
                _span_is_bold(span),
            )
        )

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


def _freeze_job_meta(group: list[dict]) -> list[tuple[str, fitz.Point, float, bool, fitz.Rect]]:
    meta: list[tuple[str, fitz.Point, float, bool, fitz.Rect]] = []
    for s in group:
        bbox = s.get("bbox")
        origin = s.get("origin")
        if origin is None:
            r = fitz.Rect(bbox)
            origin = (r.x0, r.y1)
        meta.append(
            (
                (s.get("text") or ""),
                fitz.Point(origin),
                float(s.get("size") or 12.0),
                _span_is_bold(s),
                fitz.Rect(bbox),
            )
        )
    return meta


def _insert_job_chunks(
    page: fitz.Page,
    frozen_groups: list[list[tuple[str, fitz.Point, float, bool, fitz.Rect]]],
    position_new_one_line: str | list[str],
    font_regular: str,
    font_bold: str,
    font_path_reg: Path,
    font_path_bold: Path,
) -> None:
    """Після редукції старих span-ів посади — вставити нові частини (по одному блоку на примірник)."""
    page.insert_font(font_regular, fontfile=str(font_path_reg))
    page.insert_font(font_bold, fontfile=str(font_path_bold))

    for gi, group_meta in enumerate(frozen_groups):
        if not group_meta:
            continue
        if isinstance(position_new_one_line, list):
            if gi >= len(position_new_one_line):
                print(
                    f"[попередження] немає position_new_one_line[{gi}] для блоку посади стор.{page.number + 1}",
                    file=sys.stderr,
                )
                continue
            pos_line = position_new_one_line[gi]
        else:
            pos_line = position_new_one_line
        chunks = _split_position_balanced_words(pos_line, len(group_meta))

        for ch, (_, origin, size, bold, _) in zip(chunks, group_meta):
            if not (ch or "").strip():
                continue
            fname = font_bold if bold else font_regular
            page.insert_text(
                origin,
                ch,
                fontname=fname,
                fontsize=size,
                rotate=90,
                color=(0, 0, 0),
            )


def _replace_job_blocks_after_name_redacted(
    page: fitz.Page,
    frozen_groups: list[list[tuple[str, fitz.Point, float, bool, fitz.Rect]]],
    redact_expand_pt: float = 0.0,
) -> None:
    """Редукція старих span-ів посади (прямокутники збережені до заміни ПІБ)."""
    rects: list[fitz.Rect] = []
    for group_meta in frozen_groups:
        for _, _, _, _, rect in group_meta:
            rects.append(_inflate_rect(rect, redact_expand_pt))
    for r in rects:
        page.add_redact_annot(r)
    if rects:
        page.apply_redactions()


def _extract_pages(src: fitz.Document, indices: list[int]) -> fitz.Document:
    out = fitz.open()
    for i in indices:
        if i < 0 or i >= src.page_count:
            raise ValueError(f"Некоректний індекс сторінки: {i}")
        out.insert_pdf(src, from_page=i, to_page=i)
    return out


def run(config: dict[str, Any]) -> None:
    template = Path(config["template"])
    output = Path(config["output"])
    keep = [int(x) for x in config["keep_original_page_indices"]]
    font_path_reg = Path(config.get("font_regular") or DEFAULT_FONT_REG)
    font_path_bold = Path(config.get("font_bold") or DEFAULT_FONT_BOLD)
    global_pairs: list[tuple[str, str]] = [tuple(p) for p in config.get("global_text_pairs", [])]
    per_page: list[dict[str, Any]] = config["per_page"]
    redact_expand_pt = float(config.get("redact_expand_pt", 0.35))

    if not font_path_reg.exists() or not font_path_bold.exists():
        raise FileNotFoundError("Не знайдено файли шрифтів Times New Roman")

    src = fitz.open(template)
    if src.page_count >= 1 and not src[src.page_count - 1].get_text().strip():
        src.delete_page(src.page_count - 1)

    doc = _extract_pages(src, keep)
    src.close()

    fr, fb = "tnr", "tnrb"

    # До глобальних замін: зафіксувати span-и посади (геометрія щойно зі шаблону)
    frozen_by_new_index: dict[int, list[list[tuple[str, fitz.Point, float, bool, fitz.Rect]]]] = {}
    for entry in per_page:
        orig_idx = int(entry["original_page_index"])
        if orig_idx not in keep:
            raise ValueError(f"per_page original_page_index {orig_idx} не з keep")
        new_page_no = keep.index(orig_idx)
        page = doc[new_page_no]
        name_sub = entry["name_search_substring"]
        span_list = _spans_in_order(page)
        job_groups = _job_spans_after_name(span_list, name_sub)
        if len(job_groups) != 2:
            print(
                f"[попередження] очікувалось 2 блоки посади для «{name_sub[:30]}», знайдено {len(job_groups)} стор.{page.number + 1}",
                file=sys.stderr,
            )
        frozen_by_new_index[new_page_no] = [_freeze_job_meta(g) for g in job_groups]

    back_marker_norm = "«16» квітня 2026 р.".strip()
    for page in doc:
        if not global_pairs:
            break
        if page.number == 0:
            back_pairs = [(o, n) for o, n in global_pairs if o.strip() == back_marker_norm]
            if back_pairs:
                _batch_vertical_replace(
                    page, back_pairs, fr, fb, font_path_reg, font_path_bold, redact_expand_pt
                )
        else:
            cert_pairs_pg = [(o, n) for o, n in global_pairs if o.strip() != back_marker_norm]
            if cert_pairs_pg:
                _batch_vertical_replace(
                    page, cert_pairs_pg, fr, fb, font_path_reg, font_path_bold, redact_expand_pt
                )

    for entry in per_page:
        orig_idx = int(entry["original_page_index"])
        new_page_no = keep.index(orig_idx)
        page = doc[new_page_no]
        name_sub = entry["name_search_substring"]
        name_new = entry["name_new_with_spaces"]
        pos_new = entry["position_new_one_line"]
        frozen = frozen_by_new_index[new_page_no]

        if isinstance(name_new, list) or isinstance(pos_new, list):
            if not (isinstance(name_new, list) and isinstance(pos_new, list)):
                raise ValueError(
                    "Для двох осіб на аркуші потрібні обидва поля як масиви з 2 елементів: "
                    "name_new_with_spaces і position_new_one_line"
                )
            if len(name_new) != 2 or len(pos_new) != 2:
                raise ValueError("name_new_with_spaces і position_new_one_line мають містити рівно 2 рядки (ліва/права колонка)")
            _batch_vertical_replace_sequential(
                page,
                [(name_sub.strip(), name_new[0]), (name_sub.strip(), name_new[1])],
                fr,
                fb,
                font_path_reg,
                font_path_bold,
                redact_expand_pt,
            )
        else:
            _batch_vertical_replace(
                page,
                [(name_sub.strip(), str(name_new))],
                fr,
                fb,
                font_path_reg,
                font_path_bold,
                redact_expand_pt,
            )
        _replace_job_blocks_after_name_redacted(page, frozen, redact_expand_pt)
        _insert_job_chunks(
            page,
            frozen,
            pos_new,
            fr,
            fb,
            font_path_reg,
            font_path_bold,
        )

        local_pairs: list[tuple[str, str]] = [tuple(p) for p in entry.get("page_local_text_pairs", [])]
        if local_pairs:
            olds = [o for o, _ in local_pairs]
            use_seq = len(olds) != len(set(olds))
            if use_seq:
                flat: list[tuple[str, str]] = []
                for o, n in local_pairs:
                    flat.append((o, n))
                _batch_vertical_replace_sequential(
                    page, flat, fr, fb, font_path_reg, font_path_bold, redact_expand_pt
                )
            else:
                _batch_vertical_replace(
                    page, local_pairs, fr, fb, font_path_reg, font_path_bold, redact_expand_pt
                )

    output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output, garbage=4, deflate=True, clean=True)
    doc.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Обрізання PDF відряджень + підстановка по сторінках")
    ap.add_argument("--config", type=Path, required=True, help="Локальний JSON (не комітити)")
    args = ap.parse_args()
    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    run(cfg)
    print(f"Збережено: {cfg['output']}")


if __name__ == "__main__":
    main()
