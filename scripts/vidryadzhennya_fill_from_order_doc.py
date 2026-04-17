#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Заповнення PDF посвідчень про відрядження з витягу наказу (.doc / текст) + шаблон PDF.

Читає реквізити з файлу джерела (textutil для .doc на macOS), підставляє у шаблон
усі типові поля: зворотний бік, дати, підстава, штамп, ПІБ і посада по кожній
сторінці посвідчення. Логіка підстановки — PyMuPDF (як у vidryadzhennya_from_pdf_template).

Залежності: pip install pymupdf
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

import fitz  # PyMuPDF

from vidryadzhennya_from_pdf_template import (
    DEFAULT_FONT_BOLD,
    DEFAULT_FONT_REG,
    _span_is_bold,
)

# Перше слово посади в родовому відмінку (наказ) → давальний (посвідчення)
JOB_GEN_TO_DAT: dict[str, str] = {
    "оператора": "оператору",
    "стрільця-помічника": "стрільцю-помічнику",
    "стрільця": "стрільцю",
    "стрільця-зенітника": "стрільцю-зенітнику",
    "номера": "номеру",
    "водія": "водію",
    "командира": "командиру",
    "солдата": "солдату",
    "сержанта": "сержанту",
    "головного": "головному",
}


def _doc_to_text_mac(path: Path) -> str:
    r = subprocess.run(
        ["textutil", "-convert", "txt", "-stdout", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr or "textutil failed")
    return r.stdout or ""


def _read_source_text(path: Path) -> str:
    suf = path.suffix.lower()
    if suf in (".doc",):
        return _doc_to_text_mac(path)
    return path.read_text(encoding="utf-8", errors="replace")


def _genitive_word_to_dative(w: str, upper: bool) -> str:
    w = w.strip()
    if not w:
        return w
    low = w.lower()
    for old, new in (
        ("овича", "овичу"),
        ("евича", "евичу"),
        ("іча", "ічу"),
        ("ого", "ому"),
        ("ина", "ину"),
        ("їна", "їну"),
    ):
        if low.endswith(old) and len(w) > len(old):
            base = w[: -len(old)] + new
            return base.upper() if upper else base
    if w[-1:] in "аА" and len(w) > 2:
        base = w[:-1] + ("у" if w[-1] == "а" else "У")
        return base.upper() if upper else base
    if w[-1:] in "яЯ" and len(w) > 2:
        base = w[:-1] + ("ю" if w[-1] == "я" else "Ю")
        return base.upper() if upper else base
    return w.upper() if upper else w


def _collect_spans_for_fill(page: fitz.Page, phrase: str) -> list[dict]:
    """
    Пошук span для підстановки з наказу. Короткі рядки виду лише «А7031» не шукаємо
    як підрядок після strip — інакше збігається з «А7031 №1480/…» у підставі.
    """
    pt = phrase.strip()
    strict_unit = bool(re.fullmatch(r"А\d+", pt)) and len(pt) <= 8
    found: list[dict] = []
    doc_dict = page.get_text("dict")
    for block in doc_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text") or ""
                if strict_unit:
                    if text.strip() != pt:
                        continue
                else:
                    key = phrase.strip() or phrase
                    if key not in text:
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


def _batch_vertical_replace_fill(
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
        spans = _collect_spans_for_fill(page, old)
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


def _same_text(a: str, b: str) -> bool:
    return (
        a.replace("\xa0", " ").strip() == b.replace("\xa0", " ").strip()
    )


def _align_rank_case(name_old: str, name_new: str) -> str:
    """Як у шаблоні: «Солдату» / «солдату» — копіюємо регістр першого слова зі старого span."""
    mo = re.match(r"^(\s*)(\S+)", name_old)
    mn = re.match(r"^(\s*)(\S+)", name_new)
    if not mo or not mn:
        return name_new
    ow, nw = mo.group(2), mn.group(2)
    if ow[:1].isupper() and nw[:1].islower():
        nw2 = nw[:1].upper() + nw[1:]
        return mn.group(1) + nw2 + name_new[mn.end() :]
    if ow[:1].islower() and nw[:1].isupper():
        nw2 = nw[:1].lower() + nw[1:]
        return mn.group(1) + nw2 + name_new[mn.end() :]
    return name_new


def _certificate_name_line(left_part: str) -> str:
    """Ліва частина рядка наказу до коми: «солдата … Степановича» → рядок «Видано»."""
    left_part = left_part.strip()
    if left_part.lower().startswith("головного сержанта"):
        rank_in = "головного сержанта"
        rest = left_part[len(rank_in) :].strip()
        rank_out = "головному сержанту"
    elif left_part.lower().startswith("сержанта"):
        rank_in = "сержанта"
        rest = left_part[len(rank_in) :].strip()
        rank_out = "сержанту"
    elif left_part.lower().startswith("солдата"):
        rank_in = "солдата"
        rest = left_part[len(rank_in) :].strip()
        rank_out = "солдату"
    else:
        raise ValueError(f"Невідомий рядок звання: {left_part[:80]}")

    words = rest.split()
    if len(words) < 3:
        raise ValueError(f"Замало слів у ПІБ: {rest!r}")
    surname, name, patr = words[0], words[1], " ".join(words[2:])
    sn = _genitive_word_to_dative(surname, True)
    nm = _genitive_word_to_dative(name, False)
    pt = _genitive_word_to_dative(patr, False) if " " not in patr else patr
    return f"{rank_out} {sn} {nm} {pt}"


def _job_gen_to_dat(phrase: str) -> str:
    phrase = phrase.strip().rstrip(";").strip()
    if not phrase:
        return phrase
    parts = phrase.split(None, 1)
    fw = parts[0]
    rest = parts[1] if len(parts) > 1 else ""
    low = fw.lower()
    mapped = JOB_GEN_TO_DAT.get(low)
    if mapped is None and "-" in fw:
        left, _, right = fw.partition("-")
        ml = JOB_GEN_TO_DAT.get(left.lower())
        mr = JOB_GEN_TO_DAT.get(right.lower()) if right else None
        if ml and mr:
            mapped = f"{ml}-{mr}"
        elif ml and right:
            mapped = f"{ml}-{right.lower()}"
    if mapped is None:
        mapped = fw
    return (mapped + (" " + rest if rest else "")).strip()


def _pack_job_lines(new_text: str, old_lines: list[str]) -> list[str]:
    """Розбиває текст посади на len(old_lines) рядків; останній span у шаблоні часто лише «А7031»."""
    n = len(old_lines)
    new_text = " ".join(new_text.split()).strip()
    if not new_text:
        return [""] * n

    last_t = old_lines[-1].strip()
    unit_suffix: str | None = None
    body = new_text
    if re.fullmatch(r"А\d+", last_t):
        m_unit = re.search(r"(А\d+)\s*$", new_text)
        if m_unit:
            unit_suffix = m_unit.group(1)
            body = new_text[: m_unit.start()].strip()

    if n == 1:
        return [new_text + (" " if old_lines[0].endswith(" ") else "")]

    main_lines = n - 1 if unit_suffix else n
    limits = [max(10, len(x.rstrip())) for x in old_lines[:main_lines]]
    words = body.split()
    lines_buf: list[list[str]] = [[] for _ in range(main_lines)]
    wi = 0
    for w in words:
        if wi >= main_lines:
            lines_buf[-1].append(w)
            continue
        cand = " ".join(lines_buf[wi] + [w])
        if not lines_buf[wi] or len(cand) <= limits[wi] + 10:
            lines_buf[wi].append(w)
        else:
            wi += 1
            if wi >= main_lines:
                lines_buf[-1].append(w)
            else:
                lines_buf[wi].append(w)

    out = [" ".join(x).strip() for x in lines_buf]
    while len(out) < main_lines:
        out.append("")
    out = out[:main_lines]

    if unit_suffix is not None:
        out.append(unit_suffix)

    while len(out) < n:
        out.append("")
    return out[:n]


def _ordered_spans(page: fitz.Page) -> list[str]:
    out: list[str] = []
    for b in page.get_text("dict").get("blocks", []):
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            for sp in line.get("spans", []):
                t = sp.get("text") or ""
                if t.strip():
                    out.append(t)
    return out


def _parse_order(text: str) -> dict:
    """Мінімальний парсер структури витягу БЗВП."""
    out: dict = {"personnel": []}
    m_head = re.search(
        r"(\d{2})\.(\d{2})\.(\d{4})\s+с\.\s*([^\n]+)\s+№\s*(\d+)",
        text,
        re.M,
    )
    if m_head:
        out["extract_day"] = int(m_head.group(1))
        out["extract_month"] = int(m_head.group(2))
        out["extract_year"] = int(m_head.group(3))
        out["extract_place"] = m_head.group(4).strip()
        out["extract_no"] = m_head.group(5).strip()

    m_trip = re.search(
        r"До\s+військової\s+частини\s+([АA]?\d+)\s*,\s*для\s+([^\n]+)",
        text,
        re.I,
    )
    if m_trip:
        raw_u = m_trip.group(1).upper().replace("A", "А")
        mnum = re.search(r"(\d+)$", raw_u)
        out["dest_unit"] = mnum.group(1) if mnum else raw_u
        out["trip_purpose_phrase"] = m_trip.group(2).strip()

    m_leave = re.search(
        r"“(\d+)”\s*квітня\s*(\d{4})\s*року",
        text,
    )
    if not m_leave:
        m_leave = re.search(
            r"«(\d+)»\s*квітня\s*(\d{4})\s*року",
            text,
        )
    if m_leave:
        out["leave_day"] = m_leave.group(1)
        out["leave_year"] = m_leave.group(2)

    m_block = re.search(
        r"2026\s*року:\s*\n(.*?)Зняти\s+з\s+продовольчого",
        text,
        re.S | re.I,
    )
    if m_block:
        block = m_block.group(1)
        for raw in block.splitlines():
            line = raw.strip().strip("\t")
            if not line:
                continue
            line = line.rstrip(";")
            if "," not in line:
                continue
            left, right = line.split(",", 1)
            out["personnel"].append({"left": left.strip(), "right": right.strip()})

    m_basis = re.search(
        r"Підстава:\s*([^\n]+)",
        text,
    )
    if m_basis:
        out["basis_full"] = m_basis.group(1).strip()

    m_food = re.search(
        r"з\s+(\d+)\s+квітня\s+(\d{4})\s+року",
        text,
    )
    if m_food:
        out["food_from_day"] = m_food.group(1)
        out["food_year"] = m_food.group(2)

    return out


def _split_basis_two_lines(basis_full: str) -> tuple[str, str]:
    """Як у бланку: перший рядок закінчується на «…частини », другий — решта з А7031."""
    s = basis_full.strip()
    # прибрати крапку в кінці
    s = s.rstrip(".")
    # типовий витяг: розпорядження … частини А7031 №…
    m = re.search(
        r"(розпорядження\s+командира\s+військової\s+частини)\s+(А\d+.*)",
        s,
        re.I,
    )
    if not m:
        # запасний варіант — половина по довжині
        mid = len(s) // 2
        return s[:mid] + " ", s[mid:].strip() + " "
    head = m.group(1) + " "
    tail = m.group(2).strip() + " "
    line1 = "Підстава відрядження: " + head
    line2 = tail
    return line1, line2


def _pairs_for_cert_page(
    page: fitz.Page,
    person: dict,
    meta: dict,
    purpose_line: str,
) -> list[tuple[str, str]]:
    spans = _ordered_spans(page)
    # ім'я
    name_old = None
    name_idx = None
    for i, t in enumerate(spans):
        if "(військове звання" in t:
            name_old = spans[i - 1]
            name_idx = i - 1
            break
    if not name_old:
        raise RuntimeError("Не знайдено рядка ПІБ на сторінці")

    name_new = _certificate_name_line(person["left"])
    name_new = _align_rank_case(name_old, name_new)
    # вирівнювання пробілу на початку, як у шаблоні
    if name_old.startswith(" ") and not name_new.startswith(" "):
        name_new = " " + name_new + (" " if name_old.endswith(" ") else "")
    elif name_old.endswith(" ") and not name_new.endswith(" "):
        name_new = name_new + " "

    job_old: list[str] = []
    for i, t in enumerate(spans):
        if "(посада, місце роботи)" in t:
            job_old = spans[i - 5 : i]
            break
    if len(job_old) != 5:
        raise RuntimeError("Не знайдено 5 рядків посади")

    job_dat = _job_gen_to_dat(person["right"])
    job_new_lines = _pack_job_lines(job_dat, job_old)

    pairs: list[tuple[str, str]] = []

    def _add(o: str, n: str) -> None:
        if not _same_text(o, n):
            pairs.append((o, n))

    _add(name_old, name_new)
    for o, n in zip(job_old, job_new_lines):
        n_st = n
        if o.endswith(" ") and not n_st.endswith(" "):
            n_st = n_st + " "
        _add(o, n_st)

    # пункт призначення — точний текст span зі шаблону
    dest_old = None
    for i, t in enumerate(spans):
        if "(пункти призначень)" in t and i + 1 < len(spans):
            dest_old = spans[i + 1]
            break
    if not dest_old:
        raise RuntimeError("Не знайдено рядка пункту призначення")
    du = str(meta.get("dest_unit") or "4087")
    mdu = re.search(r"А(\d+)", dest_old)
    if mdu:
        dest_new = dest_old.replace(mdu.group(0), f"А{du}")
    else:
        dest_new = dest_old
    _add(dest_old, dest_new)

    # підстава — одразу після призначення (до дати/мети), щоб редукція інших полів не зняла span підстави
    line1_old = None
    line2_old = None
    for i, t in enumerate(spans):
        if "Підстава відрядження" in t:
            line1_old = t
            if i + 1 < len(spans):
                line2_old = spans[i + 1]
            break
    if not line1_old or not line2_old:
        raise RuntimeError("Не знайдено рядків підстави")
    b1, b2 = _split_basis_two_lines(meta.get("basis_full", ""))
    _add(line2_old, b2)
    _add(line1_old, b1)

    # термін
    ld = str(meta.get("leave_day", "16"))
    date_old = None
    for t in spans:
        if "Термін відрядження" in t and "доби" in t:
            date_old = t
            break
    if not date_old:
        raise RuntimeError("Не знайдено рядка терміну відрядження")
    date_new = re.sub(r"з «\d+» квітня", f"з «{ld}» квітня", date_old)
    _add(date_old, date_new)

    # мета — span «Проходження…»
    purpose_old = None
    for t in spans:
        if t.strip().startswith("Проходження") and "Навчання" in t:
            purpose_old = t
            break
    if not purpose_old:
        purpose_old = "Проходження Навчання (ВОС-100)"
    purpose_new = purpose_line
    if purpose_old.endswith(" ") and not purpose_new.endswith(" "):
        purpose_new = purpose_new + " "
    _add(purpose_old, purpose_new)

    # штамп дата та номер витягу
    stamp_date_old = None
    stamp_no_old = None
    for t in spans:
        if "__" in t and "квітня" in t and "2026" in t:
            stamp_date_old = t
        if "№" in t and "_" in t and "79005" not in t and "К о д" not in t:
            if re.search(r"№\s*_+", t):
                stamp_no_old = t
    if stamp_date_old:
        # шаблон: пробіли + лапки-стандартні
        day = str(meta.get("leave_day", meta.get("extract_day", "16")))
        stamp_date_new = stamp_date_old.replace(
            '"__"', f"«{day}»"
        ).replace("“__”", f"«{day}»")
        if "«" not in stamp_date_new:
            stamp_date_new = re.sub(r'["“”]__["“”]', f"«{day}»", stamp_date_old)
        _add(stamp_date_old, stamp_date_new)
    if stamp_no_old and meta.get("extract_no"):
        num = meta["extract_no"]
        stamp_no_new = re.sub(r"№\s*_+", f"№ {num} ", stamp_no_old)
        _add(stamp_no_old, stamp_no_new)

    return pairs


def fill_pdf(
    template_path: Path,
    output_path: Path,
    source_path: Path,
    font_regular: Path,
    font_bold: Path,
) -> None:
    text = _read_source_text(source_path)
    meta = _parse_order(text)
    if not meta.get("personnel"):
        raise SystemExit("У джерелі не знайдено списку військовослужбовців (блок після дати виїзду).")

    purpose_line = "Проходження Навчання (ВОС-100)"
    if meta.get("trip_purpose_phrase"):
        # нормалізація з «для проходження навчання»
        p = meta["trip_purpose_phrase"].strip().rstrip(".")
        if "проходження" in p.lower():
            purpose_line = "Проходження " + p.split("проходження", 1)[-1].strip().capitalize()
            if "ВОС" not in purpose_line:
                purpose_line = purpose_line.rstrip() + " (ВОС-100)"

    doc = fitz.open(template_path)
    if doc.page_count >= 1:
        last = doc[doc.page_count - 1]
        if not last.get_text().strip():
            doc.delete_page(doc.page_count - 1)

    fr, fb = "tnr", "tnrb"

    # зворотний бік: дата виїзду
    ld = str(meta.get("leave_day", "16"))
    back_old = None
    for t in _ordered_spans(doc[0]):
        if "квітня" in t and "2026" in t and "«" in t:
            back_old = t
            break
    if back_old:
        back_new = re.sub(
            r"«\d+»",
            f"«{ld}»",
            back_old,
        )
        _batch_vertical_replace_fill(
            doc[0], [(back_old, back_new)], fr, fb, font_regular, font_bold
        )

    n_cert_pages = doc.page_count - 1
    if len(meta["personnel"]) < n_cert_pages:
        print(
            f"[попередження] у джерелі {len(meta['personnel'])} осіб, у PDF {n_cert_pages} сторінок посвідчень",
            file=sys.stderr,
        )

    for pi in range(1, doc.page_count):
        idx = pi - 1
        if idx >= len(meta["personnel"]):
            print(f"[попередження] немає даних для стор. {pi + 1}, пропуск", file=sys.stderr)
            continue
        pairs = _pairs_for_cert_page(doc[pi], meta["personnel"][idx], meta, purpose_line)
        # Уникати повторного пошуку того самого old (дубль у списку → «не знайдено span»)
        seen_old: set[str] = set()
        uniq_pairs: list[tuple[str, str]] = []
        for o, n in pairs:
            if o in seen_old:
                continue
            seen_old.add(o)
            uniq_pairs.append((o, n))
        # Окремі виклики: масова редукція багатьох span одночасно може знімати сусідні блоки
        for pr in uniq_pairs:
            _batch_vertical_replace_fill(doc[pi], [pr], fr, fb, font_regular, font_bold)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output_path, garbage=4, deflate=True, clean=True)
    doc.close()


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Заповнити PDF посвідчень з витягу наказу (.doc/текст) і шаблону PDF",
    )
    ap.add_argument("--template", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--doc", type=Path, required=True, help="Джерело: .doc (macOS textutil) або .txt")
    ap.add_argument("--font-regular", type=Path, default=DEFAULT_FONT_REG)
    ap.add_argument("--font-bold", type=Path, default=DEFAULT_FONT_BOLD)
    args = ap.parse_args()
    if not args.template.exists():
        raise SystemExit(f"Немає шаблону: {args.template}")
    if not args.doc.exists():
        raise SystemExit(f"Немає джерела: {args.doc}")

    fill_pdf(
        args.template,
        args.output,
        args.doc,
        args.font_regular,
        args.font_bold,
    )
    print(f"Збережено: {args.output}")


if __name__ == "__main__":
    main()
