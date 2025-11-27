// web/app/api/altegio/test/clients/by-instagram/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getClients } from '@/lib/altegio/clients';
import { assertAltegioEnv } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Endpoint для пошуку клієнта за Instagram username
 * Шукає в полі email (формат: instagram_username@gmail.com)
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
    const instagramUsername = searchParams.get('instagram');
    
    if (!instagramUsername) {
      return NextResponse.json(
        { 
          ok: false, 
          error: 'Instagram parameter is required. Use ?instagram=...' 
        },
        { status: 400 }
      );
    }
    
    // Нормалізуємо Instagram username (видаляємо @ якщо є, trim)
    const normalizedInstagram = instagramUsername.replace(/^@/, '').trim().toLowerCase();
    
    console.log(`[altegio/test/clients/by-instagram] Searching for client with Instagram: ${normalizedInstagram}`);
    
    // Отримуємо всіх клієнтів (можна обмежити кількість)
    // Для пошуку потрібно отримати більше клієнтів, тому спробуємо отримати 100
    const clients = await getClients(companyId, 100);
    
    // Шукаємо клієнта за Instagram username в полі email
    // Формат: "instagram_username@gmail.com" -> порівнюємо частину перед "@"
    const foundClient = clients.find(client => {
      if (!client.email || !client.email.includes('@')) {
        return false;
      }
      
      // Витягуємо Instagram username з email (частина перед "@")
      const emailParts = client.email.split('@');
      if (emailParts[0] && emailParts[0].trim()) {
        const clientInstagram = emailParts[0].trim().toLowerCase();
        // Порівнюємо нормалізовані значення
        return clientInstagram === normalizedInstagram;
      }
      
      return false;
    });
    
    if (!foundClient) {
      return NextResponse.json({
        ok: false,
        error: `Client with Instagram username "${instagramUsername}" not found`,
        instagram: instagramUsername,
        normalizedInstagram,
        searchedClients: clients.length,
      }, { status: 404 });
    }
    
    // Витягуємо Instagram username з email для відображення
    const emailParts = foundClient.email.split('@');
    const extractedInstagram = emailParts[0]?.trim() || null;
    
    return NextResponse.json({
      ok: true,
      instagram: instagramUsername,
      client: {
        id: foundClient.id,
        name: foundClient.name,
        phone: foundClient.phone,
        email: foundClient.email,
        instagramUsername: extractedInstagram,
      },
      note: 'Instagram username extracted from email field (part before @)',
    });
  } catch (err) {
    console.error('[altegio/test/clients/by-instagram] Error:', err);
    
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

