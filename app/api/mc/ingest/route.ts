// app/api/mc/ingest/route.ts
// Шим для шляху /api/mc/ingest: переекспортує ManyChat-обробник.
// Жодних імпортів з '@/lib/keycrm' не потрібно.

export const dynamic = 'force-dynamic';
export { POST } from '@/app/api/mc/manychat/route';
