"use client";

import { useState } from "react";

type AppFunction = { id: string; name: string };

type AppUser = {
  id: string;
  name: string;
  login: string;
  phone: string | null;
  functionId: string | null;
  functionName: string | null;
  isActive: boolean;
};

type Props = {
  user: AppUser;
  functions: AppFunction[];
  onClose: () => void;
  onSaved: () => void;
};

const CRESCO_LOGIN_URL = "https://cresco-crm.vercel.app/admin/login";

export function EditUserModal({ user, functions, onClose, onSaved }: Props) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [functionId, setFunctionId] = useState(user.functionId ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState<{ login: string; password: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: { name?: string; phone?: string; functionId?: string; password?: string } = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        functionId: functionId || undefined,
      };
      if (newPassword.trim()) body.password = newPassword.trim();

      const res = await fetch(`/api/admin/access/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Помилка збереження");
        return;
      }
      onSaved();
      if (newPassword.trim()) {
        setPasswordChanged({ login: user.login, password: newPassword.trim() });
      } else {
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!passwordChanged) return;
    const text = `${CRESCO_LOGIN_URL}\nЛогін: ${passwordChanged.login}\nПароль: ${passwordChanged.password}`;
    await navigator.clipboard.writeText(text);
    alert("Скопійовано!");
  };

  if (passwordChanged) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
        <div
          className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-bold mb-4">Пароль змінено</h3>
          <p className="text-sm text-gray-600 mb-3">
            Передайте користувачу посилання, логін і новий пароль для входу в Cresco CRM.
          </p>
          <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm font-mono space-y-2">
            <div>
              <span className="text-gray-500">Посилання: </span>
              <span className="break-all">{CRESCO_LOGIN_URL}</span>
            </div>
            <div>
              <span className="text-gray-500">Логін: </span>
              <span>{passwordChanged.login}</span>
            </div>
            <div>
              <span className="text-gray-500">Пароль: </span>
              <span>{passwordChanged.password}</span>
            </div>
          </div>
          <button type="button" className="btn btn-primary w-full" onClick={handleCopy}>
            Копіювати дані
          </button>
          <button
            type="button"
            className="btn btn-ghost w-full mt-2"
            onClick={() => {
              setPasswordChanged(null);
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
        <h3 className="text-lg font-bold mb-4">Редагувати користувача</h3>
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
              value={user.login}
              className="input input-bordered w-full bg-gray-100"
              readOnly
              disabled
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Новий пароль (залиште порожнім, щоб не змінювати)</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input input-bordered w-full"
              minLength={4}
              placeholder="••••••••"
            />
          </div>
          <div className="flex gap-2 pt-4">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Збереження…" : "Зберегти"}
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
