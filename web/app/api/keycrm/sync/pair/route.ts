// БУЛО:
await kvZAdd(pairIndexKey, now, String(card.id));
// СТАЛО:
await kvZAdd(pairIndexKey, { score: now, member: String(card.id) });

// Якщо індексуєш IG handle — теж виправи:
await kvZAdd(handleKey, now, String(card.id));
await kvZAdd(handleKey2, now, String(card.id));
// СТАЛО:
await kvZAdd(handleKey,  { score: now, member: String(card.id) });
await kvZAdd(handleKey2, { score: now, member: String(card.id) });
