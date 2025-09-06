// web/app/admin/campaigns/error.tsx
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Помилка на сторінці «Кампанії»</h1>
      <p className="text-sm text-gray-600">
        Можна спробувати ще раз або створити нову кампанію.
      </p>
      {error?.digest && <code className="text-xs">{error.digest}</code>}
      <div className="flex gap-3">
        <button onClick={() => reset()} className="rounded-xl px-4 py-2 border">
          Оновити
        </button>
        <a href="/admin/campaigns/new" className="rounded-xl px-4 py-2 border bg-blue-600 text-white">
          Нова кампанія
        </a>
      </div>
    </div>
  );
}
