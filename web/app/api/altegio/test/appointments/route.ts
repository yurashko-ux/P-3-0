// web/app/api/altegio/test/appointments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getUpcomingAppointments, getAppointments } from '@/lib/altegio/appointments';
import { assertAltegioEnv } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Тестовий endpoint для перевірки отримання майбутніх записів з календаря
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
    if (isNaN(companyId)) {
      return NextResponse.json(
        { 
          ok: false, 
          error: `Invalid ALTEGIO_COMPANY_ID: ${companyIdStr}` 
        },
        { status: 400 }
      );
    }
    
    // Отримуємо параметри з query string
    const searchParams = req.nextUrl.searchParams;
    const daysParam = searchParams.get('days');
    const days = daysParam ? parseInt(daysParam, 10) : 30;
    
    // Отримуємо майбутні записи
    const appointments = await getUpcomingAppointments(companyId, days, true);
    
    // Аналізуємо записи та перевіряємо наявність Instagram username у клієнтів
    const appointmentsWithInstagram = appointments.map(apt => {
      const client = apt.client;
      let instagramUsername: string | null = null;
      let instagramFieldName: string | null = null;
      
      if (client) {
        // Перевіряємо всі можливі варіанти назв поля Instagram
        const instagramFieldVariants = [
          'instagram-user-name',
          'instagram_user_name',
          'instagramUsername',
          'instagram_username',
          'instagram',
        ];
        
        for (const variant of instagramFieldVariants) {
          const foundKey = Object.keys(client).find(key => 
            key.toLowerCase().replace(/[-_]/g, '') === variant.toLowerCase().replace(/[-_]/g, '')
          );
          
          if (foundKey && client[foundKey]) {
            instagramUsername = String(client[foundKey]);
            instagramFieldName = foundKey;
            break;
          }
        }
        
        // Перевіряємо custom_fields
        if (!instagramUsername && client.custom_fields) {
          for (const variant of instagramFieldVariants) {
            const foundKey = Object.keys(client.custom_fields).find(key => 
              key.toLowerCase().replace(/[-_]/g, '') === variant.toLowerCase().replace(/[-_]/g, '')
            );
            
            if (foundKey && client.custom_fields[foundKey]) {
              instagramUsername = String(client.custom_fields[foundKey]);
              instagramFieldName = `custom_fields.${foundKey}`;
              break;
            }
          }
        }
      }
      
      return {
        id: apt.id,
        datetime: apt.datetime || apt.start_datetime || apt.date,
        client_id: apt.client_id,
        client_name: client?.name || 'Unknown',
        client_phone: client?.phone || null,
        instagram_username: instagramUsername,
        instagram_field_name: instagramFieldName,
        service_id: apt.service_id,
        staff_id: apt.staff_id,
        status: apt.status,
        has_client_data: !!client,
      };
    });
    
    const appointmentsWithInstagramCount = appointmentsWithInstagram.filter(apt => apt.instagram_username).length;
    
    return NextResponse.json({
      ok: true,
      message: `Found ${appointments.length} upcoming appointments`,
      appointmentsCount: appointments.length,
      appointmentsWithInstagram: appointmentsWithInstagramCount,
      days: days,
      appointments: appointmentsWithInstagram,
      sampleAppointment: appointments.length > 0 ? {
        fullStructure: appointments[0],
        keys: Object.keys(appointments[0]),
      } : null,
    });
  } catch (err) {
    console.error('[altegio/test/appointments] Error:', err);
    
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

