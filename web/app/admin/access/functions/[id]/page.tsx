// web/app/admin/access/functions/[id]/page.tsx
// Редагування функції (посади) та її permissions

"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PERMISSION_CATEGORIES, DEFAULT_PERMISSIONS } from "@/lib/permissions-default";
import type { PermissionKey } from "@/lib/auth-rbac";

export default function EditFunctionPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? "");
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/admin/access/functions/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Помилка завантаження");
        return r.json();
      })
      .then((data) => {
        setName(data.name ?? "");
        setPermissions((data.permissions && typeof data.permissions === "object") ? { ...DEFAULT_PERMISSIONS, ...data.permissions } : { ...DEFAULT_PERMISSIONS });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const handleToggle = (key: PermissionKey, value: "edit" | "none") => {
    setPermissions((p) => ({ ...p, [key]: value }));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Назва обовʼязкова");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/access/functions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), permissions }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Помилка збереження");
      }
      router.push("/admin/access");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <p className="text-gray-500">Завантаження…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/access" className="text-sm text-blue-600 hover:underline">
            ← Доступ
          </Link>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Назва посади</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input input-bordered w-full"
              placeholder="Наприклад: Адміністратор"
            />
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Доступи (за замовчуванням усі увімкнені; зніміть галочку для обмеження)</p>
            <div className="space-y-2">
              {PERMISSION_CATEGORIES.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(permissions[key] ?? "edit") !== "none"}
                    onChange={(e) => handleToggle(key as PermissionKey, e.target.checked ? "edit" : "none")}
                    className="checkbox checkbox-sm"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Збереження…" : "Зберегти"}
            </button>
            <Link href="/admin/access" className="btn btn-ghost">
              Скасувати
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
