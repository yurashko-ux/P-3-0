// web/app/api/campaigns/route.ts
import { NextResponse } from 'next/server';
// імпорти вашого KV/БД

export async function POST(req: Request) {
  try {
    const fd = await req.formData();

    const name = (fd.get('name') ?? '') as string;

    const basePipelineId = (fd.get('basePipelineId') ?? '') as string;
    const baseStatusId = (fd.get('baseStatusId') ?? '') as string;

    const basePipelineName = (fd.get('basePipelineName') ?? '') as string;
    const baseStatusName  = (fd.get('baseStatusName')  ?? '') as string;

    // інші поля (v1/v2/expire тощо) зчитуєте як раніше

    // зберігаємо одразу і id, і name — щоб список міг показати красиві назви
    const item = {
      id: String(Date.now()), // або ваш генератор
      name,
      base: {
        pipeline: basePipelineId,
        status: baseStatusId,
        pipelineName: basePipelineName,
        statusName: baseStatusName,
      },
      // v1, v2, counters, expire, etc...
      counters: { v1: 0, v2: 0, exp: 0 },
      deleted: false,
    };

    // TODO: запис у вашу БД/KV
    // await kvWrite.createCampaign(item) або щось подібне

    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: 'create_failed' }, { status: 500 });
  }
}

// GET лишається як було — головне, щоб повертав item.base.pipelineName / statusName, якщо є.
