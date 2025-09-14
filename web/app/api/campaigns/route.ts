// ─── ЗАМІНИ ЦИМ БЛОКОМ МІСЦЕ, ДЕ ЧИТАЮТЬСЯ КАМПАНІЇ З KV ────────────────────
// очікується всередині вашого GET-хендлера у file: web/app/api/campaigns/route.ts

// Отримати відсортований (нові зверху) список id
const ids = await kvZRevRange("campaigns:index", 0, -1).catch(() => [] as string[]);

// Акуратно зібрати кампанії, не ламаючись на рядках/порожніх значеннях
const items: Campaign[] = [];
for (const id of ids ?? []) {
  // KV може повернути або об’єкт, або JSON-рядок (залежить від того, як писали)
  let raw = await kvGet<Campaign | string | null>(`campaigns:${id}`);
  if (!raw) continue;

  // Якщо це рядок — спробувати розпарсити
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as Campaign;
    } catch {
      // пошкоджений JSON — пропускаємо
      continue;
    }
  }

  // Пропускаємо все, що не схоже на об’єкт
  if (!raw || typeof raw !== "object") continue;

  // Мінімальна валідація критичних полів (щоб сильно «биті» записи не ламали UI)
  const c = raw as Partial<Campaign>;
  if (!c.id || !c.name) {
    // можна залогувати, але не зупиняємо цикл
    continue;
  }

  items.push(raw as Campaign);
}

// Повернути відповідь
return NextResponse.json({ ok: true, count: items.length, items });
// ───────────────────────────────────────────────────────────────────────────────
