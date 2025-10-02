// ...попередній код без змін...

  // 2) Завантажуємо елементи, фільтруємо неіснуючі
  const items = await kv.mget<(Campaign | null)[]>(
    ...mergedIds.map((id) => ITEM_KEY(id))
  );

  const existing: Campaign[] = [];
  const deadIds: string[] = [];

  (items ?? []).forEach((it, i) => {
    const id = mergedIds[i];
    if (it && typeof it === "object") existing.push(it as Campaign);
    else deadIds.push(id);
  });

// ...далі без змін...
