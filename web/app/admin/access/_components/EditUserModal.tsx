"use client";

import { useState } from "react";
import { CRESCO_LOGIN_URL } from "@/lib/access/cresco-login-url";

type AppFunction = { id: string; name: string };

type AppUser = {
  id: string;
  name: string;
  login: string;
  phone: string | null;
  telegramUsername: string | null;
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

export function EditUserModal({ user, functions, onClose, onSaved }: Props) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [telegramUsername, setTelegramUsername] = useState(user.telegramUsername ?? "");
  const [functionId, setFunctionId] = useState(user.functionId ?? "");
  const [crescoLoginUrl, setCrescoLoginUrl] = useState(CRESCO_LOGIN_URL);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingAccess, setSendingAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState<{ login: string; password: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordInBlock, setShowPasswordInBlock] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const body: {
        name?: string;
        phone?: string;
        telegramUsername?: string;
        functionId?: string;
        password?: string;
      } = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        telegramUsername: telegramUsername.trim() || undefined,
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

  const handleSendAccess = async () => {
    setError(null);
    setSuccess(null);
    const password = newPassword.trim();
    if (password.length < 4) {
      setError("Щоб надіслати доступ, вкажіть пароль у полі «Новий пароль» (мін. 4 символи).");
      return;
    }
    if (!telegramUsername.trim()) {
      setError("Вкажіть Telegram username.");
      return;
    }
    if (!crescoLoginUrl.trim() || !/^https?:\/\//i.test(crescoLoginUrl.trim())) {
      setError("Вкажіть коректне посилання для входу в Креско (http/https).");
      return;
    }

    setSendingAccess(true);
    try {
      const res = await fetch(`/api/admin/access/users/${user.id}/send-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          crescoLoginUrl: crescoLoginUrl.trim(),
          telegramUsername: telegramUsername.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не вдалося надіслати доступ");
        if (data.passwordSaved) {
          onSaved();
          setPasswordChanged({ login: user.login, password });
        }
        return;
      }
      onSaved();
      setSuccess(`Доступ надіслано в Telegram @${data.telegramUsername || telegramUsername.trim()}`);
      setPasswordChanged({ login: user.login, password });
    } catch (e) {
      setError(String(e));
    } finally {
      setSendingAccess(false);
    }
  };

  const handleCopy = async () => {
    if (!passwordChanged) return;
    const link = crescoLoginUrl.trim() || CRESCO_LOGIN_URL;
    const text = `${link}\nЛогін: ${passwordChanged.login}\nПароль: ${passwordChanged.password}`;
    await navigator.clipboard.writeText(text);
    alert("Скопійовано!");
  };

  if (passwordChanged) {
    const link = crescoLoginUrl.trim() || CRESCO_LOGIN_URL;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
        <div
          className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-bold mb-4">Пароль змінено</h3>
          {success && (
            <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
              {success}
            </div>
          )}
          {error && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 text-sm">
              {error}
            </div>
          )}
          <p className="text-sm text-gray-600 mb-3">
            Передайте користувачу посилання, логін і новий пароль для входу в Cresco CRM.
          </p>
          <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm font-mono space-y-2">
            <div>
              <span className="text-gray-500">Посилання: </span>
              <span className="break-all">{link}</span>
            </div>
            <div>
              <span className="text-gray-500">Логін: </span>
              <span>{passwordChanged.login}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Пароль: </span>
              <span className="font-mono">
                {showPasswordInBlock ? passwordChanged.password : "••••••••"}
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
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
            {success}
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
            <label className="block text-sm font-medium mb-1">Номер телефону</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="input input-bordered w-full"
              placeholder="+380..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Telegram</label>
            <input
              type="text"
              value={telegramUsername}
              onChange={(e) => setTelegramUsername(e.target.value)}
              className="input input-bordered w-full"
              placeholder="@username"
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
            <label className="block text-sm font-medium mb-1">Посилання для входу в Креско</label>
            <input
              type="url"
              value={crescoLoginUrl}
              onChange={(e) => setCrescoLoginUrl(e.target.value)}
              className="input input-bordered w-full"
              placeholder={CRESCO_LOGIN_URL}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Новий пароль (залиште порожнім, щоб не змінювати)</label>
            <div className="relative">
              <input
                key={showPassword ? "text" : "password"}
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input input-bordered w-full pr-12"
                minLength={4}
                placeholder="••••••••"
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
            <p className="mt-1 text-xs text-gray-500">
              Для «Надіслати доступ» пароль обовʼязковий (старий з БД відновити не можна).
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-4">
            <button type="submit" className="btn btn-primary" disabled={loading || sendingAccess}>
              {loading ? "Збереження…" : "Зберегти"}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-primary"
              disabled={loading || sendingAccess}
              onClick={handleSendAccess}
            >
              {sendingAccess ? "Надсилання…" : "Надіслати доступ"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={sendingAccess}>
              Скасувати
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
