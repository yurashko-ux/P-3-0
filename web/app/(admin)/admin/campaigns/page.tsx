// web/app/(admin)/admin/campaigns/page.tsx
// ...залишаємо існуючі імпорти

// ↓ додай ці хелпери поруч із іншими утилітами у файлі
function nn(x?: string) {
  return (x && String(x).trim()) || "—";
}

function joinTargets(p1?: string, p2?: string, p3?: string) {
  // з’єднуємо в один компактний рядок
  return [`V1: ${nn(p1)}`, `V2: ${nn(p2)}`, `EXP: ${nn(p3)}`].join(" • ");
}

function getExpireDays(c: any): number | undefined {
  // Бек може зберігати по-різному; показуємо перше знайдене
  const v =
    c?.expDays ??
    c?.expireDays ??
    c?.expire ??
    (typeof c?.vexp === "number" ? c?.vexp : undefined);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// ...всередині компонента, там де ви мапите campaigns -> <tr>...</tr>

// Колонка «Цільова воронка» — один рядок
<td className="align-top whitespace-nowrap text-sm text-slate-800">
  {joinTargets(
    c?.t1?.pipelineName,
    c?.t2?.pipelineName,
    c?.texp?.pipelineName
  )}
</td>

// Колонка «Цільовий статус» — покажемо EXP із днями, якщо є
<td className="align-top text-sm text-slate-800">
  <div className="flex flex-col gap-1">
    <div><span className="text-slate-500 mr-2">V1</span>{nn(c?.t1?.statusName)}</div>
    <div><span className="text-slate-500 mr-2">V2</span>{nn(c?.t2?.statusName)}</div>
    <div>
      <span className="text-slate-500 mr-2">
        {(() => {
          const days = getExpireDays(c);
          return days != null ? `EXP (${days} дн.)` : "EXP";
        })()}
      </span>
      {nn(c?.texp?.statusName)}
    </div>
  </div>
</td>

// Колонка «Лічильник» — вертикально, один під одним
<td className="align-top text-sm">
  <div className="flex flex-col gap-1">
    <div className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      <span className="text-slate-500 mr-1">V1:</span>
      <span>{c?.counters?.v1 ?? 0}</span>
    </div>
    <div className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      <span className="text-slate-500 mr-1">V2:</span>
      <span>{c?.counters?.v2 ?? 0}</span>
    </div>
    <div className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      <span className="text-slate-500 mr-1">EXP:</span>
      <span>{c?.counters?.exp ?? 0}</span>
    </div>
  </div>
</td>
