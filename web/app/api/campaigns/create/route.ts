// web/app/api/campaigns/create/route.ts
// Проксі на основний обробник створення (без revalidate)
export const dynamic = 'force-dynamic';
export { POST } from '../route';
