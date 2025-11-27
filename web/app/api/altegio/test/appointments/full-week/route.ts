// web/app/api/altegio/test/appointments/full-week/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { altegioFetch } from '@/lib/altegio/client';
import { assertAltegioEnv } from '@/lib/altegio/env';
import { altegioUrl } from '@/lib/altegio/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Тестовий endpoint для отримання всіх записів за тиждень з усіма доступними полями
 * Допомагає зрозуміти, які дані доступні через API
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
    
    // Отримуємо дати на тиждень (3 дні назад + 4 дні вперед = тиждень)
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 3);
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 4);
    
    // Форматуємо дати для API (YYYY-MM-DD)
    const dateFrom = weekAgo.toISOString().split('T')[0];
    const dateTo = weekAhead.toISOString().split('T')[0];
    
    console.log(`[altegio/test/appointments/full-week] Fetching appointments from ${dateFrom} to ${dateTo}`);
    
    // Спробуємо різні варіанти endpoint для отримання всіх полів
    const attempts = [
      {
        name: 'GET /company/{id}/appointments with all includes',
        method: 'GET' as const,
        url: altegioUrl(`/company/${companyId}/appointments?date_from=${dateFrom}&date_to=${dateTo}&include[]=client&include[]=service&include[]=staff&include[]=payment&with[]=client&with[]=service&with[]=staff&with[]=payment`),
      },
      {
        name: 'GET /company/{id}/appointments with includes',
        method: 'GET' as const,
        url: altegioUrl(`/company/${companyId}/appointments?date_from=${dateFrom}&date_to=${dateTo}&include[]=*&with[]=*`),
      },
      {
        name: 'GET /company/{id}/appointments basic',
        method: 'GET' as const,
        url: altegioUrl(`/company/${companyId}/appointments?date_from=${dateFrom}&date_to=${dateTo}`),
      },
      {
        name: 'POST /company/{id}/appointments/search',
        method: 'POST' as const,
        url: altegioUrl(`/company/${companyId}/appointments/search`),
        body: JSON.stringify({
          date_from: dateFrom,
          date_to: dateTo,
          include: ['client', 'service', 'staff', 'payment'],
          with: ['client', 'service', 'staff', 'payment'],
        }),
      },
    ];
    
    let appointments: any[] = [];
    let lastSuccessfulAttempt: string | null = null;
    let lastError: Error | null = null;
    
    for (const attempt of attempts) {
      try {
        console.log(`[altegio/test/appointments/full-week] Trying ${attempt.name}...`);
        
        const options: RequestInit = {
          method: attempt.method,
        };
        
        if (attempt.body) {
          options.body = attempt.body;
        }
        
        const response = await altegioFetch<any>(attempt.url, options);
        
        // Парсимо відповідь
        let parsedAppointments: any[] = [];
        if (Array.isArray(response)) {
          parsedAppointments = response;
        } else if (response && typeof response === 'object') {
          if ('data' in response && Array.isArray(response.data)) {
            parsedAppointments = response.data;
          } else if ('appointments' in response && Array.isArray(response.appointments)) {
            parsedAppointments = response.appointments;
          } else if ('items' in response && Array.isArray(response.items)) {
            parsedAppointments = response.items;
          }
        }
        
        if (parsedAppointments.length > 0) {
          appointments = parsedAppointments;
          lastSuccessfulAttempt = attempt.name;
          console.log(`[altegio/test/appointments/full-week] ✅ Success with ${attempt.name}, got ${appointments.length} appointments`);
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[altegio/test/appointments/full-week] ❌ Failed with ${attempt.name}:`, lastError.message);
        continue;
      }
    }
    
    if (appointments.length === 0) {
      return NextResponse.json({
        ok: false,
        error: lastError?.message || 'No appointments found',
        attempts: attempts.map(a => a.name),
        lastError: lastError ? lastError.message : null,
      }, { status: 404 });
    }
    
    // Аналізуємо структуру першого запису для зрозуміння доступних полів
    const firstAppointment = appointments[0];
    const allKeys = Object.keys(firstAppointment);
    
    // Витягуємо потрібні нам дані з записів
    const appointmentsData = appointments.map(apt => {
      // ПІБ клієнта
      const clientName = apt.client?.name || apt.client_name || null;
      
      // Дата запису
      const datetime = apt.datetime || apt.start_datetime || apt.date || null;
      
      // Статус запису
      const status = apt.status || null;
      
      // Оплата послуг
      const payment = apt.payment || apt.payments || null;
      const paymentStatus = payment?.status || apt.payment_status || null;
      const paymentAmount = payment?.amount || apt.payment_amount || apt.amount || null;
      
      // Типи послуг
      const service = apt.service || null;
      const serviceName = service?.name || apt.service_name || null;
      const serviceType = service?.type || apt.service_type || null;
      const serviceId = service?.id || apt.service_id || null;
      
      // Майстер
      const staff = apt.staff || null;
      const staffName = staff?.name || apt.staff_name || null;
      const staffId = staff?.id || apt.staff_id || null;
      
      // Додаткова інформація
      const comment = apt.comment || apt.note || apt.notes || null;
      const duration = apt.duration || service?.duration || null;
      
      // Instagram username клієнта (з email)
      let instagramUsername: string | null = null;
      if (apt.client?.email && apt.client.email.includes('@')) {
        const emailParts = apt.client.email.split('@');
        if (emailParts[0] && emailParts[0].trim()) {
          instagramUsername = emailParts[0].trim();
        }
      }
      
      return {
        id: apt.id,
        clientName,
        datetime,
        status,
        payment: {
          status: paymentStatus,
          amount: paymentAmount,
          full: payment,
        },
        service: {
          id: serviceId,
          name: serviceName,
          type: serviceType,
          duration,
          full: service,
        },
        staff: {
          id: staffId,
          name: staffName,
          full: staff,
        },
        client: {
          id: apt.client?.id || apt.client_id || null,
          name: clientName,
          instagramUsername,
          full: apt.client || null,
        },
        comment,
        // Повна структура для аналізу
        rawStructure: apt,
        allKeys: Object.keys(apt),
      };
    });
    
    // Розділяємо на минулі та майбутні
    const nowTimestamp = now.getTime();
    const pastAppointments = appointmentsData.filter(apt => {
      if (!apt.datetime) return false;
      return new Date(apt.datetime).getTime() < nowTimestamp;
    });
    const futureAppointments = appointmentsData.filter(apt => {
      if (!apt.datetime) return false;
      return new Date(apt.datetime).getTime() >= nowTimestamp;
    });
    
    // Статистика по статусах
    const statusStats = appointmentsData.reduce((acc, apt) => {
      const status = apt.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Статистика по оплатах
    const paymentStats = {
      withPayment: appointmentsData.filter(apt => apt.payment?.amount || apt.payment?.status).length,
      withoutPayment: appointmentsData.filter(apt => !apt.payment?.amount && !apt.payment?.status).length,
      totalAmount: appointmentsData
        .filter(apt => apt.payment?.amount)
        .reduce((sum, apt) => sum + (parseFloat(String(apt.payment?.amount || 0)) || 0), 0),
    };
    
    return NextResponse.json({
      ok: true,
      message: `Found ${appointments.length} appointments for the week`,
      dateRange: {
        from: dateFrom,
        to: dateTo,
        days: 7,
      },
      summary: {
        total: appointments.length,
        past: pastAppointments.length,
        future: futureAppointments.length,
        statusStats,
        paymentStats,
        successfulAttempt: lastSuccessfulAttempt,
      },
      appointments: appointmentsData,
      pastAppointments,
      futureAppointments,
      firstAppointmentAnalysis: {
        allKeys,
        sampleStructure: firstAppointment,
        hasClient: !!firstAppointment.client,
        hasService: !!firstAppointment.service,
        hasStaff: !!firstAppointment.staff,
        hasPayment: !!firstAppointment.payment || !!firstAppointment.payment_status,
        clientKeys: firstAppointment.client ? Object.keys(firstAppointment.client) : [],
        serviceKeys: firstAppointment.service ? Object.keys(firstAppointment.service) : [],
        staffKeys: firstAppointment.staff ? Object.keys(firstAppointment.staff) : [],
      },
    });
  } catch (err) {
    console.error('[altegio/test/appointments/full-week] Error:', err);
    
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

