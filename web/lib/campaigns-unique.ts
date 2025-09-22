// 🔁 ЗАМІНИ У СВОЇЙ ФУНКЦІЇ СТВОРЕННЯ ПОВІДОМЛЕННЯ ОЦИМ БЛОКОМ (саме там, де вже є змінна `res`):
// Було (помилково):
// const msg = "Variant values must be unique across campaigns. Conflicts: " + res.conflicts.map(...).join('; ');

// Стало (безпечне до типів):
const conflicts =
  (res as any)?.conflicts as
    | Array<{ which: string; value: string; campaignId: string | number }>
    | undefined;

const msg =
  'Variant values must be unique across campaigns. Conflicts: ' +
  (conflicts && conflicts.length
    ? conflicts
        .map(
          (c) =>
            `[${c.which}] "${c.value}" already used in campaign ${c.campaignId}`
        )
        .join('; ')
    : 'none');
