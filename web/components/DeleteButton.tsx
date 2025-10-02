// web/components/DeleteButton.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (!confirm("Видалити кампанію?")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error("DELETE failed", res.status, t);
        alert(`Не вдалося видалити (HTTP ${res.status}).`);
        return;
      }
      // успіх
      router.refresh();
    } catch (e) {
      console.error(e);
      alert("Помилка мережі під час видалення.");
    } finally {
      setPending(false);
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
