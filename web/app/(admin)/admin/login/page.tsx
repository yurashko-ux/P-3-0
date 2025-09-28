// web/app/(admin)/admin/login/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If middleware already set cookie and redirected back here without token,
  // bounce to campaigns to avoid a loop.
  useEffect(() => {
    const hasQ = sp.get('token');
    // If no query token and we came from a redirect (history length > 1),
    // try navigating to campaigns (cookie should be present now).
    // This keeps UX smooth when user opens /admin/login directly after a prior login.
    if (!hasQ) {
      // no-op here; user can submit the form
    }
  }, [sp]);

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
      // Redirect to same route with ?token=... so middleware sets cookie and redirects back (без токена)
      // After middleware processes, user will land on /admin/login (clean) — ми одразу ведемо на /admin/campaigns.
      const here = window.location.pathname; // /admin/login
      const url = `${here}?token=${encodeURIComponent(t)}`;
      // Use hard navigation to ensure middleware runs server-side
      window.location.assign(url);
    } catch (err: any) {
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
          Підказка: можна також напряму перейти на{' '}
          <code>/admin/login?token=ВАШ_ТОКЕН</code>.
        </small>
      </div>
    </main>
  );
}
