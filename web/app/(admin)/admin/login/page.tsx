// web/app/(admin)/admin/login/page.tsx
'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginInner() {
  const sp = useSearchParams();
  const hasErr = sp.get('err') === '1';
  const [token, setToken] = React.useState('');

  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 16 }}>Логін адміна</h1>

      {hasErr && (
        <div style={{
          marginBottom: 16, padding: '12px 14px', borderRadius: 10,
          border: '1px solid #fecaca', background: '#fef2f2', color: '#7f1d1d'
        }}>
          Невірний токен або сесія завершена. Спробуйте ще раз.
        </div>
      )}

      {/* ВАЖЛИВО: method="GET" -> додає ?token=..., middleware поставить/перевірить куку */}
      <form method="GET" action="" style={{
        border: '1px solid #e8ebf0', borderRadius: 16, background: '#fff', padding: 20,
        display: 'grid', gap: 16
      }}>
        <div>
          <label htmlFor="token" style={{ display: 'block', marginBottom: 8, fontWeight: 700 }}>
            ADMIN_PASS (введіть токен)
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
            background: '#2a6df5', color: '#fff', padding: '12px 16px', borderRadius: 12,
            border: 'none', fontWeight: 800, width: 200
          }}
        >
          Увійти
        </button>
      </form>

      <div style={{ marginTop: 16, color: 'rgba(0,0,0,0.6)' }}>
        Підказка: можна також перейти напряму на <code>/admin/login?token=ВАШ_ТОКЕН</code>.
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
