// web/app/api/altegio/test/appointments/full-week/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { altegioFetch } from '@/lib/altegio/client';
import { assertAltegioEnv } from '@/lib/altegio/env';
import { altegioUrl } from '@/lib/altegio/env';
import { getVisits, getPastVisits } from '@/lib/altegio/visits';
import { getAppointments } from '@/lib/altegio/appointments';

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
    
    console.log(`[altegio/test/appointments/full-week] Fetching appointments and visits from ${dateFrom} to ${dateTo}`);
    
    // Спробуємо отримати і appointments, і visits
    // Appointments - майбутні записи, Visits - минулі/завершені візити
    let appointments: any[] = [];
    let visits: any[] = [];
    
    // Отримуємо appointments (можуть бути майбутні та минулі)
    try {
      appointments = await getAppointments(companyId, {
        dateFrom,
        dateTo,
        includeClient: true,
      });
      console.log(`[altegio/test/appointments/full-week] Got ${appointments.length} appointments`);
    } catch (err) {
      console.warn(`[altegio/test/appointments/full-week] Failed to get appointments:`, err);
    }
    
    // Отримуємо visits (завершені візити з оплатами)
    try {
      visits = await getVisits(companyId, {
        dateFrom,
        dateTo,
        includeClient: true,
        includeService: true,
        includeStaff: true,
        includePayment: true,
      });
      console.log(`[altegio/test/appointments/full-week] Got ${visits.length} visits`);
    } catch (err) {
      console.warn(`[altegio/test/appointments/full-week] Failed to get visits:`, err);
    }
    
    // Об'єднуємо appointments та visits
    // Використовуємо appointments як основне джерело, але додаємо дані про оплати з visits
    
    // Об'єднуємо appointments та visits в один список
    // Створюємо map для об'єднання даних (visit може мати appointment_id)
    const visitsMap = new Map<number, any>();
    visits.forEach(visit => {
      if (visit.appointment_id) {
        visitsMap.set(visit.appointment_id, visit);
      }
      // Також додаємо visit за його ID
      visitsMap.set(visit.id, visit);
    });
    
    // Об'єднуємо дані
    const allRecords: any[] = [];
    
    // Додаємо appointments
    appointments.forEach(apt => {
      const visit = visitsMap.get(apt.id);
      if (visit) {
        // Якщо є visit, об'єднуємо дані (visit має інформацію про оплату)
        allRecords.push({
          ...apt,
          visit_id: visit.id,
          payment: visit.payment || visit.transactions || apt.payment,
          transactions: visit.transactions,
          is_visit: true,
        });
        visitsMap.delete(apt.id);
      } else {
        // Якщо немає visit, це просто appointment
        allRecords.push({
          ...apt,
          is_visit: false,
        });
      }
    });
    
    // Додаємо visits, які не мають відповідного appointment
    visits.forEach(visit => {
      if (!allRecords.find(r => r.id === visit.id || r.visit_id === visit.id)) {
        allRecords.push({
          ...visit,
          is_visit: true,
        });
      }
    });
    
    const appointments = allRecords;
    console.log(`[altegio/test/appointments/full-week] Total records: ${appointments.length} (appointments + visits)`);
    
    if (appointments.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'No appointments or visits found',
        note: 'Tried both /appointments and /visits endpoints',
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
        appointmentsCount: appointments.length,
        visitsCount: visits.length,
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

