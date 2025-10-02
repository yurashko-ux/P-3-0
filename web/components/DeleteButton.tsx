// web/components/DeleteButton.tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function onClick() {
    try {
      await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    } catch {
      // ignore — можна додати toast у майбутньому
    } finally {
      startTransition(() => router.refresh());
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="rounded-lg bg-red-600 text-white px-4 py-1.5 text-sm shadow hover:bg-red-700 disabled:opacity-60"
    >
      {pending ? "Видаляю…" : "Видалити"}
    </button>
  );
}
