// web/lib/keycrm.ts
// ...залиш решту файлу без змін...

type Idish = number | string;

// заміни існуючу функцію kcMoveCard на цю універсальну версію:
export async function kcMoveCard(
  arg1: number | { id: Idish; pipeline_id: Idish; status_id: Idish },
  pipeline_id?: Idish,
  status_id?: Idish
): Promise<{ ok: true }> {
  let card_id: number;
  let p: Idish;
  let s: Idish;

  if (typeof arg1 === 'number') {
    // виклик формату kcMoveCard(card_id, pipeline_id, status_id)
    card_id = arg1;
    p = pipeline_id as Idish;
    s = status_id as Idish;
  } else {
    // виклик формату kcMoveCard({ id, pipeline_id, status_id })
    card_id = Number(arg1.id);
    p = arg1.pipeline_id;
    s = arg1.status_id;
  }

  return moveCard({ card_id, pipeline_id: p, status_id: s });
}
