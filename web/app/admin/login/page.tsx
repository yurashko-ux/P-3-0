// web/app/admin/login/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function AdminLoginPage({
  searchParams,
}: {
  searchParams?: { err?: string };
}) {
  // Server Action — викликається при submit форми
  async function login(formData: FormData) {
    'use server';
    const input = String(formData.get('password') || '').trim();
    const adminPass = (process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || '').trim();

    if (!adminPass) {
      // немає пароля в ENV
      redirect('/admin/login?err=env');
    }

    if (input && input === adminPass) {
      cookies().set('admin_ok', '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 днів
      });
      redirect('/admin');
    }

    // невірний пароль
    redirect('/admin/login?err=1');
  }

  const hasError = Boolean(searchParams?.err);
  const errMsg =
    searchParams?.err === 'env'
      ? 'ADMIN_PASS не налаштований у змінних середовища.'
      : 'Невірний пароль. Спробуйте ще раз.';

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-semibold mb-6">Вхід в адмінку</h1>

      {hasError && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm">
          {errMsg}
        </div>
      )}

      <form action={login} className="space-y-4">
        <div>
          <label className="block text-sm mb-2">Пароль адміністратора</label>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            className="w-full rounded-xl border px-3 py-2"
            placeholder="Введіть пароль"
            required
          />
        </div>

        <button
          type="submit"
          className="rounded-xl px-5 py-2 border bg-blue-600 text-white"
        >
          Увійти
        </button>
      </form>
    </div>
  );
}
