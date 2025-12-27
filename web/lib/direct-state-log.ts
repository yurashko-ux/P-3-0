// web/lib/direct-state-log.ts
// Функції для логування та отримання історії змін станів клієнтів

import { prisma } from "@/lib/prisma";

export type DirectClientStateLog = {
  id: string;
  clientId: string;
  state: string | null;
  previousState: string | null;
  reason?: string;
  metadata?: string;
  createdAt: string;
};

/**
 * Логує зміну стану клієнта
 */
export async function logStateChange(
  clientId: string,
  newState: string | null | undefined,
  previousState: string | null | undefined,
  reason?: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    // Логуємо тільки якщо стан дійсно змінився
    if (newState === previousState) {
      return;
    }

    await prisma.directClientStateLog.create({
      data: {
        clientId,
        state: newState || null,
        previousState: previousState || null,
        reason: reason || "unknown",
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    console.log(`[direct-state-log] ✅ Logged state change for client ${clientId}: ${previousState || 'null'} → ${newState || 'null'} (reason: ${reason || 'unknown'})`);
  } catch (err) {
    console.error(`[direct-state-log] ❌ Failed to log state change for client ${clientId}:`, err);
    // Не викидаємо помилку, щоб не порушити основний процес
  }
}

/**
 * Логує обидва стани (консультацію та нарощування), якщо вони є в одному візиті
 * Використовується для відстеження конверсії
 */
export async function logMultipleStates(
  clientId: string,
  states: Array<{ state: string | null; previousState: string | null | undefined }>,
  reason?: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    for (const { state, previousState } of states) {
      // Логуємо тільки якщо стан дійсно змінився
      if (state === previousState) {
        continue;
      }

      await prisma.directClientStateLog.create({
        data: {
          clientId,
          state: state || null,
          previousState: previousState || null,
          reason: reason || "unknown",
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });

      console.log(`[direct-state-log] ✅ Logged state change for client ${clientId}: ${previousState || 'null'} → ${state || 'null'} (reason: ${reason || 'unknown'}, multiple states)`);
    }
  } catch (err) {
    console.error(`[direct-state-log] ❌ Failed to log multiple states for client ${clientId}:`, err);
    // Не викидаємо помилку, щоб не порушити основний процес
  }
}

/**
 * Отримує історію змін станів для клієнта
 */
export async function getStateHistory(clientId: string): Promise<DirectClientStateLog[]> {
  try {
    const logs = await prisma.directClientStateLog.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });

    return logs.map((log) => ({
      id: log.id,
      clientId: log.clientId,
      state: log.state,
      previousState: log.previousState,
      reason: log.reason || undefined,
      metadata: log.metadata || undefined,
      createdAt: log.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error(`[direct-state-log] ❌ Failed to get state history for client ${clientId}:`, err);
    return [];
  }
}

/**
 * Отримує поточний стан та історію для клієнта
 */
export async function getClientStateInfo(clientId: string): Promise<{
  currentState: string | null;
  history: DirectClientStateLog[];
}> {
  try {
    const client = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: { 
        state: true,
        createdAt: true,
        source: true,
      },
    });

    if (!client) {
      return {
        currentState: null,
        history: [],
      };
    }

    const history = await getStateHistory(clientId);

    // Отримуємо повну інформацію про клієнта для перевірки записів
    const clientWithMaster = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: { 
        masterId: true,
        state: true,
        altegioClientId: true,
      },
    });
    
    const initialMasterId = clientWithMaster?.masterId;
    const currentState = clientWithMaster?.state;
    
    // Отримуємо дірект-менеджера для стану "Лід"
    const { getDirectManager } = await import('@/lib/direct-masters/store');
    const directManager = await getDirectManager();
    const directManagerId = directManager?.id;
    
    // Якщо історії немає або перший запис не є "Лід", додаємо початковий стан "Лід"
    // Клієнти з ManyChat/Instagram завжди починають зі стану "Лід"
    // Для стану "Лід" завжди використовуємо дірект-менеджера
    const hasLeadState = history.some(log => log.state === 'lead');
    const firstHistoryState = history.length > 0 ? history[history.length - 1] : null;
    
    // Якщо немає історії або перший стан не "Лід", додаємо початковий "Лід"
    if (!hasLeadState && (history.length === 0 || firstHistoryState?.previousState === null)) {
      const initialLeadLog: DirectClientStateLog = {
        id: `initial-lead-${clientId}`,
        clientId,
        state: 'lead',
        previousState: null,
        reason: 'initial',
        metadata: directManagerId ? JSON.stringify({ masterId: directManagerId }) : undefined,
        createdAt: client.createdAt.toISOString(),
      };
      
      // Додаємо на початок історії (найстаріший запис)
      history.push(initialLeadLog);
    }
    
    // Виправляємо метадані для всіх записів зі станом "Лід" - завжди встановлюємо дірект-менеджера
    for (const log of history) {
      if (log.state === 'lead' && directManagerId) {
        try {
          const metadata = log.metadata ? JSON.parse(log.metadata) : {};
          if (metadata.masterId !== directManagerId) {
            log.metadata = JSON.stringify({ masterId: directManagerId });
          }
        } catch {
          // Якщо не вдалося розпарсити метадані, встановлюємо нові
          log.metadata = JSON.stringify({ masterId: directManagerId });
        }
      }
    }

    // Перевіряємо, чи потрібно додати пропущену консультацію для клієнтів з нарощуванням
    if (currentState === 'hair-extension' && clientWithMaster?.altegioClientId) {
      const hasConsultationInHistory = history.some(log => log.state === 'consultation');
      const hasHairExtensionInHistory = history.some(log => log.state === 'hair-extension');
      
      // Якщо є нарощування в історії, але немає консультації - перевіряємо записи
      if (hasHairExtensionInHistory && !hasConsultationInHistory) {
        try {
          const { kvRead } = await import('@/lib/kv');
          const recordsLogRaw = await kvRead.lrange('altegio:records:log', 0, 9999);
          
          // Шукаємо записи з обома послугами
          const recordsWithBoth = recordsLogRaw
            .map((raw) => {
              try {
                let parsed: any;
                if (typeof raw === 'string') {
                  parsed = JSON.parse(raw);
                } else {
                  parsed = raw;
                }
                
                if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
                  try {
                    parsed = JSON.parse(parsed.value);
                  } catch {
                    return null;
                  }
                }
                
                return parsed;
              } catch {
                return null;
              }
            })
            .filter((r) => {
              if (!r || typeof r !== 'object') return false;
              const recordClientId = r.clientId || (r.data && r.data.client && r.data.client.id);
              if (parseInt(String(recordClientId), 10) !== clientWithMaster.altegioClientId) return false;
              
              const services = r.data?.services || r.services || [];
              if (!Array.isArray(services)) return false;
              
              const hasConsultation = services.some((s: any) => 
                s.title && /консультація/i.test(s.title)
              );
              const hasHairExtension = services.some((s: any) => 
                s.title && /нарощування/i.test(s.title)
              );
              
              return hasConsultation && hasHairExtension;
            })
            .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());
          
          // Якщо знайшли запис з обома послугами - додаємо консультацію в історію
          if (recordsWithBoth.length > 0) {
            const latestRecord = recordsWithBoth[0];
            const hairExtensionLog = history.find(log => log.state === 'hair-extension');
            
            if (hairExtensionLog) {
              // Перевіряємо, чи вже є консультація з такою ж датою (щоб не дублювати)
              const recordDate = latestRecord.receivedAt || latestRecord.data?.datetime || hairExtensionLog.createdAt;
              const consultationDate = new Date(recordDate);
              
              // Перевіряємо, чи немає вже консультації з такою ж датою
              const existingConsultation = history.find(log => 
                log.state === 'consultation' && 
                Math.abs(new Date(log.createdAt).getTime() - consultationDate.getTime()) < 60000 // В межах 1 хвилини
              );
              
              if (!existingConsultation) {
                // Створюємо запис про консультацію в базі
                try {
                  const consultationLogId = `missing-consultation-${clientId}-${Date.now()}`;
                  const metadata = hairExtensionLog.metadata || (initialMasterId ? JSON.stringify({ masterId: initialMasterId }) : undefined);
                  
                  await prisma.directClientStateLog.create({
                    data: {
                      id: consultationLogId,
                      clientId,
                      state: 'consultation',
                      previousState: hairExtensionLog.previousState,
                      reason: 'retroactive',
                      metadata: metadata || null,
                      createdAt: consultationDate,
                    },
                  });
                  
                  // Додаємо до історії для відображення
                  const consultationLog: DirectClientStateLog = {
                    id: consultationLogId,
                    clientId,
                    state: 'consultation',
                    previousState: hairExtensionLog.previousState,
                    reason: 'retroactive',
                    metadata: metadata || undefined,
                    createdAt: consultationDate.toISOString(),
                  };
                  
                  history.push(consultationLog);
                  console.log(`[direct-state-log] ✅ Created missing consultation log for client ${clientId} at ${consultationDate.toISOString()}`);
                } catch (err) {
                  console.warn(`[direct-state-log] Failed to create consultation log:`, err);
                  // Якщо не вдалося зберегти в базу, додаємо тільки для відображення
                  const consultationLog: DirectClientStateLog = {
                    id: `missing-consultation-${clientId}-${Date.now()}`,
                    clientId,
                    state: 'consultation',
                    previousState: hairExtensionLog.previousState,
                    reason: 'retroactive',
                    metadata: hairExtensionLog.metadata,
                    createdAt: consultationDate.toISOString(),
                  };
                  history.push(consultationLog);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`[direct-state-log] Failed to check for missing consultation:`, err);
        }
      }
    }

    // Сортуємо за датою (від старіших до новіших для відображення)
    history.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return {
      currentState: client.state || null,
      history,
    };
  } catch (err) {
    console.error(`[direct-state-log] ❌ Failed to get client state info for ${clientId}:`, err);
    return {
      currentState: null,
      history: [],
    };
  }
}
