"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

  return (
    <main className="max-w-3xl mx-auto p-3 space-y-3">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Оберіть країну — підставиться валюта. Оберіть валюту — побачите країни. «Зберегти» вмикає валюту в прийомці товару. Волосся завжди в USD. Гривню вимкнути не можна.
      </p>
      {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      <div className="bg-white border rounded-xl p-3 space-y-3">
        <label className="form-control">
          <span className="label-text text-xs">Країна</span>
          <select className="select select-bordered select-sm" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Усі</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Валюта</span>
          <select className="select select-bordered select-sm" value={code} onChange={(e) => setCode(e.target.value)}>
            {byCountry.map((row) => (
              <option key={row.code} value={row.code}>
                {row.code} — {row.title}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <p className="text-xs text-gray-600">Країни: {selected.countries.join(", ")}</p>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void save(code, true)}>
            Зберегти (увімкнути)
          </button>
          {code !== "UAH" && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void save(code, false)}>
              Вимкнути
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-xl p-3">
        <p className="font-semibold text-sm mb-2">Увімкнені в прийомці</p>
        <ul className="text-sm space-y-1">
          {enabled.filter((row) => row.enabled).map((row) => (
            <li key={row.code}>
              {row.code} — {row.title}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
