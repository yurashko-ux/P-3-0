// Хто виконує дію в розділі Команда (для архіву).

import type { AuthContext } from "@/lib/auth-rbac";

export function teamActor(auth: AuthContext): { userId: string | null; name: string } {
  if (auth.type === "user") {
    const name = String(auth.userName || auth.login || "").trim() || "Користувач";
    return { userId: auth.userId, name };
  }
  return { userId: null, name: "Адміністратор" };
}
