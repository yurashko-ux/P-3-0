// 🔧 Постав ЦЕЙ фрагмент ЗАМІСТЬ блоку, де зараз рахується `msg` з `res.conflicts`.
// Тобто заміни починаючи з рядка з:
//   const msg = "Variant values must be unique across campaigns. Conflicts: " + res.conflicts
// і до кінця .map(...).join('; ')
//
// Безпечний варіант (типобезпечний і не ламає існуючу логіку):

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
