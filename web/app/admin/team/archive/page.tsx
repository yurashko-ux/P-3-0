"use client";

import { useCallback, useEffect, useState } from "react";

type HiddenMember = {
  id: string;
  name: string;
  salonRole: string;
  createdAt: string;
  hiddenAt: string | null;
  hiddenByName: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  master: "Майстер",
  assistant: "Асистент",
  admin: "Адміністратор",
  direct: "Direct",
  other: "Інше",
};

function formatKyiv(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function TeamArchivePage() {
  const [members, setMembers] = useState<HiddenMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team/archive", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка архіву");
      setMembers(json.members || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(member: HiddenMember) {
    if (!confirm(`Повернути «${member.name}» у списки?`)) return;
    setBusyId(member.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/team/members/${member.id}/restore`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не повернуто");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка повернення");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="p-3 space-y-3 max-w-5xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Звільнені, яких приховали зі списків. Документи з їхнім іменем лишаються. «Повернути» знову показує людину в CRM.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Імʼя</th>
              <th>Роль</th>
              <th>Створено</th>
              <th>Приховано</th>
              <th>Ким</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{ROLE_LABEL[m.salonRole] || m.salonRole}</td>
                <td className="whitespace-nowrap tabular-nums">{formatKyiv(m.createdAt)}</td>
                <td className="whitespace-nowrap tabular-nums">{formatKyiv(m.hiddenAt)}</td>
                <td>{m.hiddenByName || "—"}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-xs"
                    disabled={busyId === m.id}
                    onClick={() => void restore(m)}
                  >
                    Повернути
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && members.length === 0 && (
          <p className="p-4 text-sm text-gray-500">Архів порожній.</p>
        )}
        {loading && members.length === 0 && <p className="p-4 text-sm text-gray-400">Завантаження…</p>}
      </div>
    </main>
  );
}
