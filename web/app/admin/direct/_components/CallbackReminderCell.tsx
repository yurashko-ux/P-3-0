// web/app/admin/direct/_components/CallbackReminderCell.tsx
// Колонка «Передзвонити»: дата (Kyiv-календар) + коментар

"use client";

import { useEffect, useState } from "react";
import type { DirectClient } from "@/lib/direct-types";

const KYIV_TZ = "Europe/Kyiv";

function kyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type Props = {
  client: DirectClient;
  onUpdate: (updates: Partial<DirectClient>) => Promise<void>;
};

export function CallbackReminderCell({ client, onUpdate }: Props) {
  const day = client.callbackReminderKyivDay ?? "";
  const noteServer = client.callbackReminderNote ?? "";
  const [noteDraft, setNoteDraft] = useState(noteServer);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNoteDraft(noteServer);
  }, [noteServer, client.id]);

  const todayYmd = kyivTodayYmd();
  const isDueToday = Boolean(day && day === todayYmd);
  const isPast = Boolean(day && day < todayYmd);

  const persist = async (patch: Partial<DirectClient>) => {
    setSaving(true);
    try {
      await onUpdate(patch);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-0.5 min-w-0 max-w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="date"
        className={`input input-xs w-full max-w-[10.5rem] tabular-nums ${
          isDueToday ? "border-amber-400 bg-amber-50" : isPast ? "border-rose-300/80 bg-rose-50/60" : ""
        }`}
        value={day}
        disabled={saving}
        title={day ? `Передзвін заплановано на ${day} (Kyiv)` : "Оберіть дату передзвону"}
        onChange={(e) => {
          const v = e.target.value;
          void persist({
            callbackReminderKyivDay: v === "" ? null : v,
            callbackReminderNote: noteDraft.trim() === "" ? null : noteDraft.trim(),
          });
        }}
      />
      <input
        type="text"
        className="input input-xs w-full text-[10px] leading-snug placeholder:text-gray-400"
        placeholder="Коментар…"
        maxLength={2000}
        value={noteDraft}
        disabled={saving}
        title={noteDraft || "Коментар до передзвону"}
        onChange={(e) => setNoteDraft(e.target.value)}
        onBlur={() => {
          const t = noteDraft.trim();
          const prev = (noteServer || "").trim();
          if (t === prev) return;
          void persist({
            callbackReminderKyivDay: day || null,
            callbackReminderNote: t === "" ? null : t,
          });
        }}
      />
    </div>
  );
}
