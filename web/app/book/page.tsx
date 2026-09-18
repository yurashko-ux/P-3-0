"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Master = { id: string; name: string; altegioStaffId: number };
type Service = { id: string; title: string; kind: string; durationSec: number };

function moneyDuration(sec: number) {
  const m = Math.round((Number(sec) || 0) / 60);
  if (m < 60) return `${m} хв`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} год ${rest} хв` : `${h} год`;
}

function formatDayLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("uk-UA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Kyiv",
  }).format(dt);
}

export default function OnlineBookPage() {
  const [masters, setMasters] = useState<Master[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    staffName: string | null;
    datetime: string;
    serviceTitle: string;
  } | null>(null);

  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [website, setWebsite] = useState(""); // honeypot

  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) || null,
    [services, serviceId],
  );

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/book", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити");
      setMasters(json.masters || []);
      setServices(json.services || []);
      setDays(json.days || []);
      if (!serviceId && json.services?.[0]?.id) setServiceId(json.services[0].id);
      if (!staffId && json.masters?.[0]?.id) setStaffId(json.masters[0].id);
      if (!day && json.days?.[0]) setDay(json.days[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, [serviceId, staffId, day]);

  useEffect(() => {
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!day || !staffId || !serviceId) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    setTime("");
    setError(null);
    fetch(`/api/book?day=${encodeURIComponent(day)}&staffId=${encodeURIComponent(staffId)}&serviceId=${encodeURIComponent(serviceId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error || "Слоти недоступні");
        setSlots(json.slots || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Помилка слотів");
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [day, staffId, serviceId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          serviceId,
          staffId,
          day,
          time,
          comment: comment || null,
          website,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не записано");
      setDone({
        staffName: json.appointment?.staffName || null,
        datetime: json.appointment?.datetime || `${day}T${time}`,
        serviceTitle: selectedService?.title || "Послуга",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const when = new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(done.datetime));
    return (
      <main className="min-h-screen bg-[#f4f1ec] text-stone-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-stone-200 rounded-2xl p-6 space-y-3 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Ви записані</h1>
          <p className="text-sm text-stone-600">
            {done.serviceTitle}
            {done.staffName ? ` · ${done.staffName}` : ""}
          </p>
          <p className="text-lg font-medium capitalize">{when}</p>
          <p className="text-xs text-stone-500">
            Запис уже в журналі салону. Якщо треба змінити час — напишіть адміністратору.
          </p>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setDone(null);
              setTime("");
              void loadCatalog();
            }}
          >
            Записатись ще раз
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f1ec] text-stone-900">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-5">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Kresco</p>
          <h1 className="text-3xl font-semibold tracking-tight">Онлайн-запис</h1>
          <p className="text-sm text-stone-600">Оберіть послугу, майстра й зручний час.</p>
        </header>

        {error && <div className="rounded-xl bg-red-50 text-red-800 text-sm px-3 py-2 border border-red-100">{error}</div>}
        {loading ? (
          <p className="text-sm text-stone-500">Завантаження…</p>
        ) : (
          <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3 shadow-sm">
            <label className="block space-y-1">
              <span className="text-xs text-stone-500">Послуга</span>
              <select
                className="select select-bordered w-full"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({moneyDuration(s.durationSec)})
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-stone-500">Майстер</span>
              <select
                className="select select-bordered w-full"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-stone-500">День</span>
              <select
                className="select select-bordered w-full"
                value={day}
                onChange={(e) => setDay(e.target.value)}
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    {formatDayLabel(d)} · {d}
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="text-xs text-stone-500">Час</span>
              {slotsLoading ? (
                <p className="text-sm text-stone-500 py-2">Шукаємо вільні слоти…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-stone-500 py-2">Немає вільних слотів на цей день</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`btn btn-sm ${time === s ? "btn-neutral" : "btn-outline"}`}
                      onClick={() => setTime(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-stone-500">Ваше імʼя</span>
              <input
                className="input input-bordered w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-stone-500">Телефон</span>
              <input
                className="input input-bordered w-full"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+380…"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-stone-500">Коментар (необовʼязково)</span>
              <input
                className="input input-bordered w-full"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>

            {/* honeypot */}
            <input
              tabIndex={-1}
              autoComplete="off"
              className="hidden"
              aria-hidden
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              name="website"
            />

            <button
              type="button"
              className="btn btn-neutral w-full"
              disabled={busy || !time || !name.trim() || !phone.trim()}
              onClick={() => void submit()}
            >
              {busy ? "Записуємо…" : "Записатись"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
