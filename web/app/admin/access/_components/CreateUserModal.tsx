"use client";

import { useState } from "react";

type AppFunction = { id: string; name: string };

type Props = {
  functions: AppFunction[];
  onClose: () => void;
  onCreated: () => void;
};

const APP_URL = typeof window !== "undefined" ? window.location.origin + "/admin/login" : "https://p-3-0.vercel.app/admin/login";

export function CreateUserModal({ functions, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [functionId, setFunctionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ login: string; password: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/access/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          login: login.trim(),
          password,
          phone: phone.trim() || undefined,
          functionId: functionId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Помилка створення");
        return;
      }
      setCreated({ login: data.user.login, password });
      onCreated();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    const text = `${APP_URL}\nЛогін: ${created.login}\nПароль: ${created.password}`;
    await navigator.clipboard.writeText(text);
    alert("Скопійовано!");
  };

  if (created) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
        <div
          className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-bold mb-4">Користувача створено</h3>
          <p className="text-sm text-gray-600 mb-4">
            Посилання, логін і пароль готові до копіювання.
          </p>
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={handleCopy}
          >
            Скопіювати
          </button>
          <button
            type="button"
            className="btn btn-ghost w-full mt-2"
            onClick={() => {
              setCreated(null);
              onClose();
            }}
          >
            Закрити
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-4">Створити користувача</h3>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Імʼя</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input input-bordered w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Функція</label>
            <select
              value={functionId}
              onChange={(e) => setFunctionId(e.target.value)}
              className="select select-bordered w-full"
            >
              <option value="">— Оберіть —</option>
              {functions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Номер телефону (Telegram)</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input input-bordered w-full"
              placeholder="+380..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Логін</label>
            <input
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className="input input-bordered w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input input-bordered w-full"
              required
              minLength={4}
            />
          </div>
          <div className="flex gap-2 pt-4">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Створення…" : "Створити користувача"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Скасувати
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
