"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  PrettySelect,
  cardClass,
  formRowClass,
  ghostButtonClass,
  labelClass,
  tileButtonClass,
  tileGridClass,
  tintButtonClass,
} from "../_components/warehouse-ui";

/** Відтінки й символи валют — як плитки кас (гривня, долар, євро). */
const CURRENCY_TINT: Record<string, string> = { UAH: "#f6efdf", USD: "#e5f2e9", EUR: "#e6eef8" };
const CURRENCY_SYMBOL: Record<string, string> = { UAH: "₴", USD: "$", EUR: "€", PLN: "zł", GBP: "£" };

type DirRow = { code: string; title: string; countries: string[] };
type Enabled = { code: string; title: string; enabled: boolean };

export default function WarehouseCurrenciesPage() {
  const [directory, setDirectory] = useState<DirRow[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Enabled[]>([]);
  const [country, setCountry] = useState("");
  const [code, setCode] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/warehouse/currencies", { credentials: "include" });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
    setDirectory(json.directory || []);
    setCountries(json.countries || []);
    setEnabled(json.enabled || []);
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Помилка"));
  }, [load]);

  const selected = directory.find((row) => row.code === code) || null;
  const byCountry = useMemo(() => {
    if (!country) return directory;
    return directory.filter((row) => row.countries.includes(country));
  }, [country, directory]);

  useEffect(() => {
    if (country && byCountry[0] && !byCountry.some((row) => row.code === code)) {
      setCode(byCountry[0].code);
    }
  }, [country, byCountry, code]);

  const save = async (nextCode: string, on: boolean) => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/warehouse/currencies", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: nextCode, enabled: on }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
      setNotice(on ? `Валюта ${nextCode} доступна в прийомці товару.` : `Валюту ${nextCode} вимкнено.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    }
  };

  const active = enabled.filter((row) => row.enabled);

  return (
    <main className="mx-auto max-w-4xl space-y-2 px-2 pb-6">
      <div className={`${tileGridClass} py-2`}>
        {active.map((row) => (
          <button
            key={row.code}
            type="button"
            className={`${tileButtonClass} ${row.code === code ? "ring-2 ring-blue-300" : ""}`}
            style={{ background: CURRENCY_TINT[row.code] || "#f3f5f8" }}
            title="Обрати валюту"
            onClick={() => {
              setCountry("");
              setCode(row.code);
            }}
          >
            <span className="text-[10px] font-medium leading-tight text-gray-700">{row.title}</span>
            <span className="mt-0.5 text-sm font-semibold">{CURRENCY_SYMBOL[row.code] || row.code}</span>
            <span className="text-[10px] text-gray-500">{row.code}</span>
          </button>
        ))}
      </div>

      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      <div className={`${cardClass} overflow-hidden`}>
        <div className="px-4 py-2.5" style={{ background: "#e3edf9" }}>
          <h3 className="text-sm font-semibold text-gray-900">Валюта в прийомці товару</h3>
        </div>
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3">
            <div className={formRowClass}>
              <span className={labelClass}>Країна</span>
              <div className="max-w-[300px]">
                <PrettySelect
                  value={country}
                  tint="#e3edf9"
                  options={[{ value: "", label: "Усі" }, ...countries.map((c) => ({ value: c, label: c }))]}
                  onChange={setCountry}
                />
              </div>
            </div>
            <div className={formRowClass}>
              <span className={labelClass}>Валюта</span>
              <div className="max-w-[300px]">
                <PrettySelect
                  value={code}
                  tint="#e3edf9"
                  options={byCountry.map((row) => ({ value: row.code, label: `${row.code} — ${row.title}` }))}
                  onChange={setCode}
                />
              </div>
            </div>
            {selected && (
              <div className={formRowClass}>
                <span className={labelClass}>Країни</span>
                <span className="text-xs text-gray-700">{selected.countries.join(", ")}</span>
              </div>
            )}
          </div>
          <p className="text-[10px] text-gray-500">
            Оберіть країну — підставиться валюта. Оберіть валюту — побачите країни. «Увімкнути» додає валюту в прийомку товару.
            Волосся завжди в USD. Гривню вимкнути не можна.
          </p>
          <div className="flex justify-end gap-2">
            {code !== "UAH" && active.some((row) => row.code === code) && (
              <button type="button" className={ghostButtonClass} onClick={() => void save(code, false)}>
                Вимкнути
              </button>
            )}
            <button
              type="button"
              className={tintButtonClass()}
              style={{ background: "#e3edf9" }}
              onClick={() => void save(code, true)}
            >
              Увімкнути {code}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
