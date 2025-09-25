'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

function readCookie(name: string) {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name.replace(/[-.[\\]{}()*+?^$|\\\\]/g, '\\$&') + '=([^;]*)')
  );
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name: string, val: string) {
  document.cookie = `${name}=${encodeURIComponent(val)}; path=/; SameSite=Lax`;
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [adminToken, setAdminToken] = React.useState<string | null>(null);
  const [showTokenInput, setShowTokenInput] = React.useState(false);
  const [tokenDraft, setTokenDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  // form state
  const [name, setName] = React.useState('UI-created');
  const [basePipelineId, setBasePipelineId] = React.useState<number | ''>(111);
  const [baseStatusId, setBaseStatusId] = React.useState<number | ''>(222);
  const [v1op, setV1op] = React.useState<'contains' | 'equals'>('contains');
  const [v1val, setV1val] = React.useState('ціна');
  const [v2op, setV2op] = React.useState<'contains' | 'equals'>('equals');
  const [v2val, setV2val] = React.useState('привіт');

  React.useEffect(() => {
    const token = readCookie('admin_token');
    setAdminToken(token);
    setShowTokenInput(!token);
  }, []);

  async function saveToken() {
    if (!tokenDraft.trim()) {
      setMsg('Введи адмін-токен (змінна ENV ADMIN_PASS на Vercel).');
      return;
    }
    // пробуємо серверний запис (опціонально)
    try {
      await fetch('/api/auth/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenDraft.trim() }),
      });
    } catch {
      // fall back: клієнтський запис
      setCookie('admin_token', tokenDraft.trim());
    }
    // гарантовано ставимо куку на клієнті, щоб одразу працювало
    setCookie('admin_token', tokenDraft.trim());
    setAdminToken(tokenDraft.trim());
    setShowTokenInput(false);
    setMsg('Токен збережено. Можеш створювати кампанію.');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!adminToken) {
      setMsg('Немає адмін-токена. Введи токен вище.');
      setShowTokenInput(true);
      return;
    }
    if (!name.trim()) {
      setMsg('Назва обовʼязкова.');
      return;
    }
    if (basePipelineId === '' || baseStatusId === '') {
      setMsg('Потрібні ID воронки та статусу.');
      return;
    }

    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        base_pipeline_id: Number(basePipelineId),
        base_status_id: Number(baseStatusId),
        rules: {
          v1: { op: v1op, value: v1val ?? '' },
          v2: { op: v2op, value: v2val ?? '' },
        },
      };

      const resp = await fetch('/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken,
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const data = await resp.json().catch(() => ({}));
      const createdId = data?.id || data?.item?.id;

      setMsg('Кампанію створено ✅');
      // невелика пауза щоб KV записався
      setTimeout(() => {
        router.push('/admin/campaigns');
      }, 300);
    } catch (err: any) {
      console.error(err);
      const t = String(err?.message || err);
      if (t.includes('401')) {
        setMsg('401 Unauthorized — адмін-токен неправильний або відсутній.');
        setShowTokenInput(true);
      } else if (t.includes('failed to parse') || t.includes('WRONGTYPE')) {
        setMsg('Помилка KV. Спробуй ще раз або очисти тестові ключі через /api/debug/kv.');
      } else {
        setMsg(`Помилка створення: ${t}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Створити кампанію</h1>

      {/* Банер про токен */}
      {!adminToken && (
        <div className="mb-4 rounded-lg border p-3 bg-yellow-50">
          <div className="font-medium">Немає адмін-токена</div>
          <div className="text-sm">
            Введи значення ENV <code>ADMIN_PASS</code> (напр. <code>11111</code>) нижче і збережи.
          </div>
        </div>
      )}

      {/* Ввід/оновлення токена */}
      {showTokenInput && (
        <div className="mb-6 rounded-xl border p-4">
          <label className="block text-sm mb-1">Admin token</label>
          <input
            className="w-full border rounded-md px-3 py-2"
            placeholder="встав тут свій ADMIN_PASS"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={saveToken}
              className="px-3 py-2 rounded-md border bg-black text-white disabled:opacity-60"
            >
              Зберегти токен
            </button>
            <button
              type="button"
              onClick={() => {
                setCookie('admin_token', '');
                setAdminToken(null);
                setShowTokenInput(true);
                setMsg('Токен очищено');
              }}
              className="px-3 py-2 rounded-md border"
            >
              Очистити токен
            </button>
          </div>
        </div>
      )}

      {/* Повідомлення */}
      {msg && (
        <div className="mb-4 rounded-lg border p-3 bg-slate-50 whitespace-pre-wrap">
          {msg}
        </div>
      )}

      {/* Форма створення */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Назва</label>
          <input
            className="w-full border rounded-md px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Campaign"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Base pipeline ID</label>
            <input
              type="number"
              className="w-full border rounded-md px-3 py-2"
              value={basePipelineId}
              onChange={(e) => setBasePipelineId(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Base status ID</label>
            <input
              type="number"
              className="w-full border rounded-md px-3 py-2"
              value={baseStatusId}
              onChange={(e) => setBaseStatusId(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="font-medium mb-3">Правила</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1">V1 — оператор</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={v1op}
                onChange={(e) => setV1op(e.target.value as any)}
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </select>
              <label className="block text-sm mt-3 mb-1">V1 — значення</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={v1val}
                onChange={(e) => setV1val(e.target.value)}
                placeholder="напр. ціна"
              />
            </div>

            <div>
              <label className="block text-sm mb-1">V2 — оператор</label>
              <select
                className="w-full border rounded-md px-3 py-2"
                value={v2op}
                onChange={(e) => setV2op(e.target.value as any)}
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </select>
              <label className="block text-sm mt-3 mb-1">V2 — значення</label>
              <input
                className="w-full border rounded-md px-3 py-2"
                value={v2val}
                onChange={(e) => setV2val(e.target.value)}
                placeholder="напр. привіт"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-md border bg-black text-white disabled:opacity-60"
          >
            {busy ? 'Зберігаю…' : 'Створити'}
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-md border"
            onClick={() => router.push('/admin/campaigns')}
          >
            До списку
          </button>
        </div>
      </form>
    </div>
  );
}
