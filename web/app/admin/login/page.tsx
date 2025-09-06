// web/app/admin/login/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default function AdminLoginPage({
  searchParams,
}: {
  searchParams?: { err?: string };
}) {
  async function login(formData: FormData) {
    'use server';
    const input = String(formData.get('password') || '').trim();
    const adminPass =
      process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || '';

    if (adminPass && input && input === adminPass) {
      // логін успішний → ставимо cookie на 30 днів
      cookies().set('admin_ok', '1', {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      redirect('/admin');
    }

    // невірний пароль → повертаємо з помилкою
    redirect('/admin/login?err=1');
  }

  const hasError = Boolean(searchParams?.err);

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-semibold mb-6">Вхід в адмінку</h1>

      {hasError && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm">
          Невірний пароль. Спробуйте ще раз.
        </div>
      )}

      <form action={login} className="space-y-4">
        <div>
          <label className="block text-sm mb-2">Пароль адміністратора</label>
          <input
            type="password"
            name="password"
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
