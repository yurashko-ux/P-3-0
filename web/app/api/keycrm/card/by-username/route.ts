фimport { NextResponse } from 'next/server';
import { findCardIdByUsername } from '../../../../../lib/keycrm';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const u = url.searchParams.get('u') || '';
  const id = await findCardIdByUsername(u);
  return NextResponse.json({ ok: true, card_id: id });
}
import { NextResponse } from 'next/server';import { findCardIdByUsername } from '../../../../../../lib/keycrm'
export async function GET(req:Request){const url=new URL(req.url);const u=url.searchParams.get('u')||'';const id=await findCardIdByUsername(u);return NextResponse.json({ok:true,card_id:id})}
