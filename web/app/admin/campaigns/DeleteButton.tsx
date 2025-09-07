// web/app/admin/campaigns/DeleteButton.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onDelete = async () => {
    if (!confirm('Видалити кампанію? Це дію неможливо скасувати.')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      router.refresh();
    } catch {
      alert('Помилка видалення');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={onDelete}
      disabled={loading}
      className="rounded-xl border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
      aria-label="Delete campaign"
      title="Delete"
    >
      {loading ? '...' : 'Delete'}
    </button>
  );
}
