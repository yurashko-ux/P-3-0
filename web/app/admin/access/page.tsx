// web/app/admin/access/page.tsx
// Розділ Доступи: користувачі та функції (посади)

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CreateUserModal } from "./_components/CreateUserModal";
import { CreateFunctionModal } from "./_components/CreateFunctionModal";
import { EditUserModal } from "./_components/EditUserModal";

const CRESCO_LOGIN_URL = "https://cresco-crm.vercel.app";

type AppUser = {
  id: string;
  name: string;
  login: string;
  phone: string | null;
  isActive: boolean;
  functionName: string | null;
  functionId: string | null;
};

type AppFunction = {
  id: string;
  name: string;
  permissions: Record<string, string>;
};

export default function AccessPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [functions, setFunctions] = useState<AppFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [functionModalOpen, setFunctionModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [uRes, fRes] = await Promise.all([
        fetch("/api/admin/access/users"),
        fetch("/api/admin/access/functions"),
      ]);
      if (!uRes.ok || !fRes.ok) {
        const res = !uRes.ok ? uRes : fRes;
        const text = await res.text();
        let errMsg = "Помилка завантаження";
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          try {
            const data = JSON.parse(text) as { error?: string };
            if (data.error) errMsg = data.error;
          } catch {
            // fallback нижче
          }
        } else if (text && text.length < 500 && !text.trimStart().startsWith("<")) {
          errMsg = text;
        } else {
          errMsg = "Сервер повернув помилку. Можливо, таблиці app_users/functions ще не створені (міграція).";
        }
        setError(errMsg);
        return;
      }
      const uData = await uRes.json();
      const fData = await fRes.json();
      setUsers(Array.isArray(uData) ? uData : uData.users || []);
      setFunctions(Array.isArray(fData) ? fData : fData.functions || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Доступи</h1>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">
            ← На головну
          </Link>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-500">Завантаження…</p>
        ) : (
          <div className="grid gap-8 md:grid-cols-[5fr_3fr]">
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Користувачі</h2>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => setUserModalOpen(true)}
                >
                  + Створити користувача
                </button>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {users.length === 0 ? (
                  <p className="p-4 text-gray-500 text-sm">Немає користувачів</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium">Імʼя</th>
                        <th className="px-4 py-2 text-left font-medium">Функція</th>
                        <th className="px-4 py-2 text-left font-medium">Логін</th>
                        <th className="px-4 py-2 text-left font-medium">Телефон</th>
                        <th className="px-4 py-2 text-left font-medium">Статус</th>
                        <th className="px-4 py-2 text-left font-medium">Дії</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t border-gray-100">
                          <td className="px-4 py-2">{u.name}</td>
                          <td className="px-4 py-2">{u.functionName ?? "—"}</td>
                          <td className="px-4 py-2 font-mono">{u.login}</td>
                          <td className="px-4 py-2">{u.phone ?? "—"}</td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              className={
                                u.isActive
                                  ? "text-green-600 hover:underline"
                                  : "text-gray-400 hover:underline"
                              }
                              disabled={togglingId === u.id}
                              onClick={async () => {
                                setTogglingId(u.id);
                                try {
                                  const res = await fetch(`/api/admin/access/users/${u.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ isActive: !u.isActive }),
                                  });
                                  if (res.ok) loadData();
                                } finally {
                                  setTogglingId(null);
                                }
                              }}
                            >
                              {u.isActive ? "Активний" : "Неактивний"}
                            </button>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={() => setEditUser(u)}
                              >
                                Редагувати
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs"
                                onClick={async () => {
                                  const text = `${CRESCO_LOGIN_URL}\nЛогін: ${u.login}`;
                                  await navigator.clipboard.writeText(text);
                                  alert("Скопійовано посилання та логін.");
                                }}
                              >
                                Копіювати
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-error"
                                disabled={deletingId === u.id}
                                onClick={async () => {
                                  if (!confirm("Видалити облікові дані цього користувача? Вхід по цьому логіну буде неможливий.")) return;
                                  setDeletingId(u.id);
                                  try {
                                    const res = await fetch(`/api/admin/access/users/${u.id}`, {
                                      method: "DELETE",
                                    });
                                    if (res.ok) loadData();
                                    else {
                                      const data = await res.json().catch(() => ({}));
                                      alert(data.error || "Помилка видалення");
                                    }
                                  } finally {
                                    setDeletingId(null);
                                  }
                                }}
                              >
                                Видалити
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Функції (посади)</h2>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => setFunctionModalOpen(true)}
                >
                  + Створити функцію
                </button>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {functions.length === 0 ? (
                  <p className="p-4 text-gray-500 text-sm">Немає функцій</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {functions.map((f) => (
                      <li key={f.id} className="px-4 py-3 flex items-center justify-between">
                        <span className="font-medium">{f.name}</span>
                        <Link
                          href={`/admin/access/functions/${f.id}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Редагувати
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {userModalOpen && (
        <CreateUserModal
          functions={functions}
          onClose={() => setUserModalOpen(false)}
          onCreated={() => {
            setUserModalOpen(false);
            loadData();
          }}
        />
      )}

      {functionModalOpen && (
        <CreateFunctionModal
          onClose={() => setFunctionModalOpen(false)}
          onCreated={() => {
            setFunctionModalOpen(false);
            loadData();
          }}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          functions={functions}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            loadData();
          }}
        />
      )}
    </main>
  );
}
