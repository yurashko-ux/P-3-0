// web/app/(admin)/admin/login/page.tsx
'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginInner() {
  const sp = useSearchParams();
  const hasErr = sp.get('err') === '1';
  const [token, setToken] = React.useState('');
  const [login, setLogin] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login.trim() || undefined, password }),
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = '/admin/direct';
        return;
      }
      setError(data.error || 'Помилка входу');
    } catch (err) {
      setError('Помилка мережі');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 16 }}>Логін адміна</h1>

      {(hasErr || error) && (
        <div style={{
          marginBottom: 16, padding: '12px 14px', borderRadius: 10,
          border: '1px solid #fecaca', background: '#fef2f2', color: '#7f1d1d'
        }}>
          {error || 'Невірний токен або сесія завершена. Спробуйте ще раз.'}
        </div>
      )}

      {/* Логін через login+password (AppUser) */}
      <form onSubmit={handlePasswordLogin} style={{
        border: '1px solid #e8ebf0', borderRadius: 16, background: '#fff', padding: 20,
        display: 'grid', gap: 16, marginBottom: 24
      }}>
        <div>
          <label htmlFor="login" style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>
            Логін (опційно для супер-адміна)
          </label>
          <input
            id="login"
            name="login"
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Логін користувача"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: '1px solid #dfe3ea', background: '#f8fbff'
            }}
          />
        </div>
        <div>
          <label htmlFor="password" style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>
            Пароль
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            required
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: '1px solid #dfe3ea', background: '#f8fbff'
            }}
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          style={{
            background: '#2a6df5', color: '#fff', padding: '12px 16px', borderRadius: 12,
            border: 'none', fontWeight: 800, width: 200
          }}
        >
          {submitting ? 'Вхід...' : 'Увійти'}
        </button>
      </form>

      {/* Супер-адмін: token через GET */}
      <div style={{ marginBottom: 16, color: 'rgba(0,0,0,0.6)', fontSize: 14 }}>
        Або для супер-адміна (ADMIN_PASS):
      </div>
      <form method="GET" action="" style={{
        border: '1px solid #e8ebf0', borderRadius: 16, background: '#fff', padding: 20,
        display: 'grid', gap: 16
      }}>
        <div>
          <label htmlFor="token" style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>
            ADMIN_PASS (токен)
          </label>
          <input
            id="token"
            name="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Введіть ADMIN_PASS"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12,
              border: '1px solid #dfe3ea', background: '#f8fbff'
            }}
          />
        </div>
        <button
          type="submit"
          style={{
            background: '#6b7280', color: '#fff', padding: '12px 16px', borderRadius: 12,
            border: 'none', fontWeight: 800, width: 200
          }}
        >
          Увійти (токен)
        </button>
      </form>

      <div style={{ marginTop: 16, color: 'rgba(0,0,0,0.6)' }}>
        Підказка: можна перейти на <code>/admin/login?token=ВАШ_ТОКЕН</code>.
      </div>

      <div style={{ marginTop: 10 }}>
        <a href="/admin/logout" style={{ color: '#6b7280', textDecoration: 'underline' }}>
          Вийти (очистити сесію)
        </a>
      </div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Завантаження…</div>}>
      <LoginInner />
    </Suspense>
  );
}
