// web/app/api/campaigns/create/route.ts
// Сумісність зі старою адресою форми: /api/campaigns/create
// Використовує той самий POST-обробник, що і /api/campaigns
export { POST, dynamic } from '../route';
