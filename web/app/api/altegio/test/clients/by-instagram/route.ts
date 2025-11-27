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
    
    // Отримуємо клієнтів з великим лімітом для пошуку
    // Спробуємо отримати максимальну кількість клієнтів для пошуку
    // Використовуємо кілька спроб з різними лімітами, щоб знайти всіх клієнтів
    let allClients: any[] = [];
    const limitsToTry = [1000, 2000, 5000, 10000];
    
    for (const limit of limitsToTry) {
      console.log(`[altegio/test/clients/by-instagram] Trying to get clients with limit ${limit}...`);
      const clients = await getClients(companyId, limit);
      console.log(`[altegio/test/clients/by-instagram] Received ${clients.length} clients with limit ${limit}`);
      
      // Оновлюємо список всіх клієнтів (може бути дублювання, але це нормально)
      allClients = clients;
      
      // Якщо отримали менше ніж ліміт, значить це всі клієнти (або API не повертає більше)
      if (clients.length < limit) {
        console.log(`[altegio/test/clients/by-instagram] Received ${clients.length} clients (less than limit ${limit}), assuming all clients retrieved`);
        break;
      }
    }
    
    const clients = allClients;
    console.log(`[altegio/test/clients/by-instagram] Total clients for search: ${clients.length}`);
    
    // Якщо не знайдено клієнта в основному списку, спробуємо також через appointments
    // (деякі клієнти можуть бути тільки в appointments, а не в основному списку)
    
    // Відфільтруємо клієнтів з email для логування
    const clientsWithEmail = clients.filter(c => c.email && c.email.includes('@'));
    console.log(`[altegio/test/clients/by-instagram] Clients with email: ${clientsWithEmail.length}`);
    
    // Логуємо приклади email для діагностики
    if (clientsWithEmail.length > 0) {
      const sampleEmails = clientsWithEmail.slice(0, 5).map(c => {
        const emailParts = c.email.split('@');
        return {
          email: c.email,
          instagramPart: emailParts[0]?.trim().toLowerCase() || null,
        };
      });
      console.log(`[altegio/test/clients/by-instagram] Sample email Instagram parts:`, sampleEmails);
    }
    
    // Функція для перевірки чи клієнт має потрібний Instagram username
    const checkClientInstagram = (client: any): boolean => {
      if (!client.email || !client.email.includes('@')) {
        return false;
      }
      
      // Витягуємо Instagram username з email (частина перед "@")
      const emailParts = client.email.split('@');
      if (emailParts[0] && emailParts[0].trim()) {
        const clientInstagram = emailParts[0].trim().toLowerCase();
        // Порівнюємо нормалізовані значення
        const match = clientInstagram === normalizedInstagram;
        if (match) {
          console.log(`[altegio/test/clients/by-instagram] ✅ Match found! Client ${client.id}, email: ${client.email}`);
        }
        return match;
      }
      
      return false;
    };
    
    // Шукаємо клієнта за Instagram username в полі email
    // Формат: "instagram_username@gmail.com" -> порівнюємо частину перед "@"
    let foundClient = clients.find(checkClientInstagram);
    
    // Якщо не знайдено в основному списку, спробуємо також через appointments
    if (!foundClient) {
      console.log(`[altegio/test/clients/by-instagram] Client not found in main list, trying via appointments...`);
      try {
        const { getUpcomingAppointments } = await import('@/lib/altegio/appointments');
        // Отримуємо appointments на великий період (90 днів назад + вперед)
        const appointments = await getUpcomingAppointments(companyId, 90, true);
        
        // Витягуємо унікальних клієнтів з appointments
        const clientsFromAppointments = new Map<number, any>();
        for (const apt of appointments) {
          if (apt.client && apt.client.id && !clientsFromAppointments.has(apt.client.id)) {
            clientsFromAppointments.set(apt.client.id, apt.client);
          }
        }
        
        console.log(`[altegio/test/clients/by-instagram] Found ${clientsFromAppointments.size} unique clients via appointments`);
        
        // Перевіряємо клієнтів з appointments
        for (const client of clientsFromAppointments.values()) {
          if (checkClientInstagram(client)) {
            foundClient = client;
            console.log(`[altegio/test/clients/by-instagram] ✅ Found via appointments! Client ${client.id}, email: ${client.email}`);
            break;
          }
        }
      } catch (appointmentsErr) {
        console.warn(`[altegio/test/clients/by-instagram] Failed to search via appointments:`, appointmentsErr);
      }
    }
    
    if (!foundClient) {
      // Додаткова інформація для діагностики
      const similarMatches = clientsWithEmail
        .filter(c => {
          const emailParts = c.email.split('@');
          const clientInstagram = emailParts[0]?.trim().toLowerCase() || '';
          return clientInstagram.includes(normalizedInstagram) || normalizedInstagram.includes(clientInstagram);
        })
        .slice(0, 5)
        .map(c => {
          const emailParts = c.email.split('@');
          return {
            id: c.id,
            name: c.name,
            email: c.email,
            instagramPart: emailParts[0]?.trim().toLowerCase() || null,
          };
        });
      
      // Приклади email для діагностики (перші 10)
      const sampleEmails = clientsWithEmail
        .slice(0, 10)
        .map(c => {
          const emailParts = c.email.split('@');
          return {
            id: c.id,
            name: c.name,
            email: c.email,
            instagramPart: emailParts[0]?.trim().toLowerCase() || null,
          };
        });
      
      return NextResponse.json({
        ok: false,
        error: `Client with Instagram username "${instagramUsername}" not found`,
        instagram: instagramUsername,
        normalizedInstagram,
        diagnostics: {
          searchedClients: clients.length,
          clientsWithEmail: clientsWithEmail.length,
          clientsWithoutEmail: clients.length - clientsWithEmail.length,
        },
        similarMatches: similarMatches.length > 0 ? similarMatches : undefined,
        sampleEmails: sampleEmails.length > 0 ? sampleEmails : undefined,
        note: similarMatches.length > 0 
          ? `Found ${similarMatches.length} similar matches (see similarMatches array)`
          : `Searched ${clients.length} clients (${clientsWithEmail.length} with email). Check sampleEmails for format examples.`,
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

