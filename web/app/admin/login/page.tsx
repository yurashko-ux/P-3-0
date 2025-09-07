// web/app/admin/login/page.tsx
// SERVER wrapper: тут ставимо revalidate/dynamic і обгортаємо клієнтський компонент у Suspense.
import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500">Завантаження…</div>}>
      <LoginClient />
    </Suspense>
  );
}
