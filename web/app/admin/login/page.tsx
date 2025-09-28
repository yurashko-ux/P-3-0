// web/app/admin/login/page.tsx
'use client';

import { useState } from 'react';

export default function AdminLoginPage() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const t = token.trim();
    if (!t) {
      setError('Введіть токен адміністратора.');
      return;
    }
    setBusy(true);
    try {
      // Додаємо ?token= до URL — middleware поставить cookie і прибере параметр
      const here = window.location.pathname; // /admin/login
      window.location.assign(`${here}?token=${encodeURIComponent(t)}`);
    } catch {
      setError('Не вдалося виконати вхід.');
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '64px auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Вхід до адмін-панелі</h1>
      <p style={{ marginBottom: 12, opacity: 0.8 }}>
        Введіть адміністративний токен. Після відправки сторінка додасть <code>?token=</code> до URL,
        middleware збереже cookie <code>admin_token</code> і прибере токен з адреси.
      </p>

      <form onSubmit={handleSubmit}>
        <label htmlFor="token" style={{ display: 'block', fontSize: 14, marginBottom: 8 }}>
          Адмін-токен
        </label>
        <input
          id="token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Введіть ADMIN_PASS"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #ccc',
            marginBottom: 12,
          }}
        />
        {error && (
          <div style={{ color: '#b00020', marginBottom: 12 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            background: busy ? '#bbb' : '#000',
            color: '#fff',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Вхід…' : 'Увійти'}
        </button>
      </form>

      <div style={{ marginTop: 16 }}>
        <small style={{ opacity: 0.7 }}>
          Підказка: можна також перейти напряму на <code>/admin/login?token=ВАШ_ТОКЕН</code>.
        </small>
      </div>
    </main>
  );
}
