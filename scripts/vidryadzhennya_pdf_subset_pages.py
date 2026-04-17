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
  "keep_original_page_indices": [0, 6, 1, 2, 3, 4, 5],
  "position_font_size": 12,
  "position_min_font_size": 9,
  "position_field_y_expand_max_pt": 100,
  "position_field_inset_pt": 1.5,
  "position_column_pitch_factor": 1.12,
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

Поле «посада, місце роботи»: перенос лише по словах (жадібні вертикальні колонки за text_length), без insert_textbox MuPDF;
жирний, position_font_size; нижній край — нижня межа поля; position_column_pitch_factor — крок між колонками.
Повний перерозподіл відступів між «79005…» і «ПОСВІДЧЕННЯ» без зміни шаблону PDF обмежений — надійніше зібрати бланк у Word і експортувати в PDF.

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


def _union_from_spans(group: list[dict]) -> fitz.Rect:
    """Об’єднаний bbox усіх span-ів блоку «посада»."""
    if not group:
        return fitz.Rect(0, 0, 0, 0)
    x0 = min(s["bbox"][0] for s in group)
    y0 = min(s["bbox"][1] for s in group)
    x1 = max(s["bbox"][2] for s in group)
    y1 = max(s["bbox"][3] for s in group)
    return fitz.Rect(x0, y0, x1, y1)


def _rect_vertical_overlap(a: fitz.Rect, b: fitz.Rect) -> float:
    ih = min(a.y1, b.y1) - max(a.y0, b.y0)
    return max(0.0, ih)


def _job_field_left_barrier_x(page: fitz.Page, union: fitz.Rect) -> float:
    """Максимальний x правої межі елементів ліворуч від поля посади (наприклад підказка про звання)."""
    pr = page.rect
    barrier = pr.x0 + 8
    min_ov = max(12.0, union.height * 0.2)
    for s in _spans_in_order(page):
        t = s.get("text") or ""
        if "(військове звання" not in t:
            continue
        r = fitz.Rect(s["bbox"])
        if _rect_vertical_overlap(r, union) < min_ov:
            continue
        barrier = max(barrier, r.x1)
    return barrier + 0.5


def _job_field_right_barrier_x(page: fitz.Page, union: fitz.Rect) -> float:
    """Мінімальний x лівої межі підказки «(посада, місце роботи)» праворуч від поля."""
    pr = page.rect
    barrier = pr.x1 - 8
    min_ov = max(12.0, union.height * 0.2)
    for s in _spans_in_order(page):
        t = s.get("text") or ""
        if "(посада" not in t:
            continue
        r = fitz.Rect(s["bbox"])
        if _rect_vertical_overlap(r, union) < min_ov:
            continue
        barrier = min(barrier, r.x0)
    return barrier - 0.5


def _apply_job_field_inset(rect: fitz.Rect, inset_pt: float) -> fitz.Rect:
    """Внутрішні поля, щоб гліфи не виходили за колонку (менше накладань між двома примірниками)."""
    if inset_pt <= 0:
        return rect
    return fitz.Rect(
        rect.x0 + inset_pt,
        rect.y0,
        rect.x1 - inset_pt,
        rect.y1,
    )


def _fit_job_draw_rect(page: fitz.Page, union: fitz.Rect, min_width: float = 68.0) -> fitz.Rect:
    """
    Прямокутник для insert_textbox: між мітками зліва/справа, по центру відносно блоку шаблону;
    ширина — max(union, min_width), але не ширше доступного проміжку.
    """
    lb = _job_field_left_barrier_x(page, union)
    rb = _job_field_right_barrier_x(page, union)
    avail = rb - lb
    if avail < 12:
        return union
    target_w = min(max(union.width, min_width), avail)
    cx = (union.x0 + union.x1) * 0.5
    x0 = cx - target_w / 2.0
    x0 = max(lb, x0)
    x1 = x0 + target_w
    if x1 > rb:
        x1 = rb
        x0 = max(lb, x1 - target_w)
    return fitz.Rect(x0, union.y0, x1, union.y1)


def _split_words_uk(text: str) -> list[str]:
    """Розбиття на слова лише по пробілах (без дивних групувань)."""
    return [w for w in (text or "").split() if w]


def _columns_word_wrap_vertical(
    words: list[str],
    font: fitz.Font,
    fontsize: float,
    max_column_height_pt: float,
    max_columns: int,
) -> list[str] | None:
    """
    Для тексту з rotate=90: одна «колонка» — вертикальний стовпчик; довжина стовпчика в pt
    дорівнює горизонтальній ширині рядка (text_length). Перенос лише між словами, без розриву всередині слова.
    """
    if max_columns < 1 or max_column_height_pt <= 1.0:
        return None
    columns: list[str] = []
    cur: list[str] = []
    for w in words:
        if not cur:
            if font.text_length(w, fontsize=fontsize) > max_column_height_pt:
                return None
            cur = [w]
            continue
        trial = " ".join(cur + [w])
        if font.text_length(trial, fontsize=fontsize) <= max_column_height_pt:
            cur.append(w)
        else:
            columns.append(" ".join(cur))
            if len(columns) > max_columns:
                return None
            if font.text_length(w, fontsize=fontsize) > max_column_height_pt:
                return None
            cur = [w]
    if cur:
        columns.append(" ".join(cur))
    if len(columns) > max_columns:
        return None
    return columns


def _insert_job_field_textbox(
    page: fitz.Page,
    draw_rect: fitz.Rect,
    text: str,
    font_bold: str,
    font_path_bold: Path,
    font_size: float,
    min_font_size: float,
    y_expand_max_pt: float,
    field_inset_pt: float,
    column_pitch_factor: float,
) -> None:
    """
    Поле посади: перенос **лише по словах** (жадібне заповнення колонки), без insert_textbox MuPDF.
    Колонки з rotate=90 йдуть зліва направо; нижній край тексту — нижня межа поля (origin по базовій лінії).
    Горизонтально блок колонок центрується в полі.
    """
    words = _split_words_uk(text)
    if not words:
        return
    page.insert_font(font_bold, fontfile=str(font_path_bold))
    font = fitz.Font(fontfile=str(font_path_bold))

    inner = _apply_job_field_inset(draw_rect, field_inset_pt)
    pad = 1.25
    y_top_limit = max(8.0, draw_rect.y0 - y_expand_max_pt)
    # Максимальна «довжина» однієї колонки в pt (для rotate=90 це text_length рядка)
    max_h_col = max(12.0, inner.y1 - y_top_limit - 2 * pad)

    fs_try = font_size
    columns: list[str] | None = None
    fs_used = font_size
    while fs_try >= min_font_size - 1e-6:
        pitch = fs_try * column_pitch_factor
        max_cols = max(1, int((inner.width - 2 * pad) / max(pitch, 0.01)))
        columns = _columns_word_wrap_vertical(words, font, fs_try, max_h_col, max_cols)
        if columns is not None:
            fs_used = fs_try
            break
        fs_try -= 0.5

    if columns is None:
        print(
            f"[попередження] посада: не вдалось розкласти по словах (стор.{page.number + 1})",
            file=sys.stderr,
        )
        return

    y_origin = inner.y1 - pad
    cx = (inner.x0 + inner.x1) * 0.5
    pitch = fs_used * column_pitch_factor
    n = len(columns)
    half_span = ((n - 1) * pitch) * 0.5
    for i, col in enumerate(columns):
        x = cx - half_span + i * pitch
        page.insert_text(
            (x, y_origin),
            col,
            fontname=font_bold,
            fontsize=fs_used,
            rotate=90,
            color=(0, 0, 0),
        )


def _replace_job_field_redacted(
    page: fitz.Page,
    draw_rects: list[fitz.Rect],
    redact_expand_pt: float = 0.0,
) -> None:
    """Біла підкладка під полем посади перед вставкою textbox."""
    for r in draw_rects:
        page.add_redact_annot(_inflate_rect(r, redact_expand_pt))
    if draw_rects:
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
    position_font_size = float(config.get("position_font_size", 12.0))
    position_min_font_size = float(config.get("position_min_font_size", 9.0))
    position_y_expand_max_pt = float(config.get("position_field_y_expand_max_pt", 100.0))
    position_field_inset_pt = float(config.get("position_field_inset_pt", 1.5))
    position_column_pitch_factor = float(config.get("position_column_pitch_factor", 1.12))

    if not font_path_reg.exists() or not font_path_bold.exists():
        raise FileNotFoundError("Не знайдено файли шрифтів Times New Roman")

    src = fitz.open(template)
    if src.page_count >= 1 and not src[src.page_count - 1].get_text().strip():
        src.delete_page(src.page_count - 1)

    doc = _extract_pages(src, keep)
    src.close()

    fr, fb = "tnr", "tnrb"

    # До глобальних замін: геометрія поля «посада» (прямокутники для textbox)
    job_draw_rects_by_new_index: dict[int, list[fitz.Rect]] = {}
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
        job_draw_rects_by_new_index[new_page_no] = [
            _fit_job_draw_rect(page, _union_from_spans(g)) for g in job_groups
        ]

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
        draw_rects = job_draw_rects_by_new_index[new_page_no]

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
        _replace_job_field_redacted(page, draw_rects, redact_expand_pt)
        if isinstance(pos_new, list):
            for gi, dr in enumerate(draw_rects):
                if gi >= len(pos_new):
                    break
                _insert_job_field_textbox(
                    page,
                    dr,
                    str(pos_new[gi]),
                    fb,
                    font_path_bold,
                    position_font_size,
                    position_min_font_size,
                    position_y_expand_max_pt,
                    position_field_inset_pt,
                    position_column_pitch_factor,
                )
        else:
            for dr in draw_rects:
                _insert_job_field_textbox(
                    page,
                    dr,
                    str(pos_new),
                    fb,
                    font_path_bold,
                    position_font_size,
                    position_min_font_size,
                    position_y_expand_max_pt,
                    position_field_inset_pt,
                    position_column_pitch_factor,
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
