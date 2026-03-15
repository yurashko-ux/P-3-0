"use client";

import { useState } from "react";

type AppFunction = { id: string; name: string };

type Props = {
  functions: AppFunction[];
  onClose: () => void;
  onCreated: () => void;
};

// Посилання для входу користувачів (Cresco CRM) — завжди cresco-crm.vercel.app
const CRESCO_LOGIN_URL = "https://cresco-crm.vercel.app/admin/login";

export function CreateUserModal({ functions, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [functionId, setFunctionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ login: string; password: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordInBlock, setShowPasswordInBlock] = useState(true);

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
    const text = `${CRESCO_LOGIN_URL}\nЛогін: ${created.login}\nПароль: ${created.password}`;
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
          <p className="text-sm text-gray-600 mb-3">
            Передайте користувачу посилання, логін і пароль для входу в Cresco CRM.
          </p>
          <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm font-mono space-y-2">
            <div>
              <span className="text-gray-500">Посилання: </span>
              <span className="break-all">{CRESCO_LOGIN_URL}</span>
            </div>
            <div>
              <span className="text-gray-500">Логін: </span>
              <span>{created.login}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Пароль: </span>
              <span className="font-mono">
                {showPasswordInBlock ? created.password : "••••••••"}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square p-1"
                onClick={() => setShowPasswordInBlock((v) => !v)}
                aria-label={showPasswordInBlock ? "Приховати пароль" : "Показати пароль"}
                title={showPasswordInBlock ? "Приховати пароль" : "Показати пароль"}
              >
                {showPasswordInBlock ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={handleCopy}
          >
            Копіювати дані
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
            <div className="relative">
              <input
                key={showPassword ? "text" : "password"}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input input-bordered w-full pr-12"
                required
                minLength={4}
                autoComplete="off"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Приховати пароль" : "Показати пароль"}
                title={showPassword ? "Приховати пароль" : "Показати пароль"}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
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
