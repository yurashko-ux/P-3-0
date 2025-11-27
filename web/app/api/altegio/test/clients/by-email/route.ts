// web/app/api/altegio/test/clients/by-email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getClients } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Endpoint для пошуку клієнта за email
 */
export async function GET(req: NextRequest) {
  try {
    assertAltegioEnv();
    
    const companyIdStr = process.env.ALTEGIO_COMPANY_ID;
    if (!companyIdStr) {
      return NextResponse.json(
        { 
          ok: false, 
          error: 'ALTEGIO_COMPANY_ID not set in environment variables' 
        },
        { status: 400 }
      );
    }
    
    const companyId = parseInt(companyIdStr, 10);
    const searchParams = req.nextUrl.searchParams;
    const email = searchParams.get('email');
    
    if (!email) {
      return NextResponse.json(
        { 
          ok: false, 
          error: 'Email parameter is required. Use ?email=...' 
        },
        { status: 400 }
      );
    }
    
    console.log(`[altegio/test/clients/by-email] Searching for client with email: ${email}`);
    
    // Отримуємо всіх клієнтів (можна обмежити кількість)
    // Для пошуку потрібно отримати більше клієнтів, тому спробуємо отримати 100
    const clients = await getClients(companyId, 100);
    
    // Шукаємо клієнта за email
    const foundClient = clients.find(client => {
      if (!client.email) return false;
      // Перевіряємо точне співпадіння
      return client.email.toLowerCase().trim() === email.toLowerCase().trim();
    });
    
    if (!foundClient) {
      return NextResponse.json({
        ok: false,
        error: `Client with email "${email}" not found`,
        email,
        searchedClients: clients.length,
      }, { status: 404 });
    }
    
    // Нормалізуємо Instagram username з email (якщо є)
    let instagramUsername: string | null = null;
    if (foundClient.email && foundClient.email.includes('@')) {
      const emailParts = foundClient.email.split('@');
      if (emailParts[0] && emailParts[0].trim()) {
        instagramUsername = emailParts[0].trim();
      }
    }
    
    return NextResponse.json({
      ok: true,
      email,
      client: {
        id: foundClient.id,
        name: foundClient.name,
        phone: foundClient.phone,
        email: foundClient.email,
        instagramUsername,
        // Повна структура
        fullStructure: foundClient,
      },
      note: 'Instagram username extracted from email field (part before @)',
    });
  } catch (err) {
    console.error('[altegio/test/clients/by-email] Error:', err);
    
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

