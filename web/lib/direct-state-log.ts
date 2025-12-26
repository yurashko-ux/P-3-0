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

    // Якщо історії немає або перший запис не є "Лід", додаємо початковий стан "Лід"
    // Клієнти з ManyChat/Instagram завжди починають зі стану "Лід"
    const hasLeadState = history.some(log => log.state === 'lead');
    const firstHistoryState = history.length > 0 ? history[history.length - 1] : null;
    
    // Отримуємо початковий masterId клієнта (дірект-менеджер для лідів)
    const clientWithMaster = await prisma.directClient.findUnique({
      where: { id: clientId },
      select: { masterId: true },
    });
    
    const initialMasterId = clientWithMaster?.masterId;
    
    // Якщо немає історії або перший стан не "Лід", додаємо початковий "Лід"
    if (!hasLeadState && (history.length === 0 || firstHistoryState?.previousState === null)) {
      const initialLeadLog: DirectClientStateLog = {
        id: `initial-lead-${clientId}`,
        clientId,
        state: 'lead',
        previousState: null,
        reason: 'initial',
        metadata: initialMasterId ? JSON.stringify({ masterId: initialMasterId }) : undefined,
        createdAt: client.createdAt.toISOString(),
      };
      
      // Додаємо на початок історії (найстаріший запис)
      history.push(initialLeadLog);
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
