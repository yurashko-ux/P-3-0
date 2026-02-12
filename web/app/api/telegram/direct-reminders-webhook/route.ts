// web/app/api/telegram/direct-reminders-webhook/route.ts
// Webhook endpoint для нового бота нагадувань Direct клієнтів

import { NextRequest, NextResponse } from "next/server";
import { assertDirectRemindersBotToken, TELEGRAM_ENV } from "@/lib/telegram/env";
import { TelegramUpdate } from "@/lib/telegram/types";
import {
  answerCallbackQuery,
  sendMessage,
  editMessageText,
} from "@/lib/telegram/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isTemplateOrPlaceholderNamePart(value?: string | null): boolean {
  if (!value) return true;
  const v = String(value).trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  if (v.includes("{{") || v.includes("}}")) return true;
  if (lower === "not found") return true;
  return false;
}

async function tryFixClientNameFromRecordsLog(altegioClientId: number, directClientId: string) {
  try {
    const { prisma } = await import('@/lib/prisma');
    const { kvRead } = await import('@/lib/kv');

    const current = await prisma.directClient.findUnique({
      where: { id: directClientId },
      select: { id: true, firstName: true, lastName: true, altegioClientId: true },
    });

    if (!current) return;
    if (current.altegioClientId !== altegioClientId) {
      console.log(`[direct-reminders-webhook] ⚠️ Пропускаємо оновлення імені: directClientId=${directClientId} має altegioClientId=${current.altegioClientId}, очікували ${altegioClientId}`);
      return;
    }

    const needsFix =
      isTemplateOrPlaceholderNamePart(current.firstName) ||
      isTemplateOrPlaceholderNamePart(current.lastName);

    if (!needsFix) {
      return;
    }

    const rawItems = await kvRead.lrange('altegio:records:log', 0, 9999);
    let best: any = null;
    let bestTime = 0;

    for (const raw of rawItems) {
      try {
        let parsed: any = raw;
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        // KV інколи повертає { value: "..." }
        if (parsed && typeof parsed === 'object' && 'value' in parsed && typeof parsed.value === 'string') {
          try {
            parsed = JSON.parse(parsed.value);
          } catch {
            // ignore
          }
        }
        if (!parsed || typeof parsed !== 'object') continue;
        const cid = parsed.clientId ?? parsed.data?.client?.id ?? parsed.data?.client_id;
        if (Number(cid) !== altegioClientId) continue;

        const dt = parsed.datetime || parsed.data?.datetime || parsed.receivedAt;
        const ts = dt ? new Date(dt).getTime() : 0;
        if (ts >= bestTime) {
          bestTime = ts;
          best = parsed;
        }
      } catch {
        // ignore one bad record
      }
    }

    const clientObj = best?.data?.client || null;
    const fullNameRaw =
      (clientObj?.name || clientObj?.display_name || best?.clientName || '').toString().trim();

    if (!fullNameRaw) {
      console.log(`[direct-reminders-webhook] ⚠️ Не знайшли імʼя в altegio:records:log для Altegio ID ${altegioClientId}`);
      return;
    }
    if (fullNameRaw.includes("{{") || fullNameRaw.includes("}}")) {
      console.log(`[direct-reminders-webhook] ⚠️ Імʼя з records:log містить плейсхолдер, пропускаємо: "${fullNameRaw}" (Altegio ID ${altegioClientId})`);
      return;
    }

    const parts = fullNameRaw.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || null;
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;

    if (!firstName) return;

    await prisma.directClient.update({
      where: { id: directClientId },
      data: {
        firstName,
        lastName,
        updatedAt: new Date(),
      },
    });

    console.log(`[direct-reminders-webhook] ✅ Оновили імʼя клієнта ${directClientId} з records:log: "${firstName} ${lastName || ''}".trim() (Altegio ID ${altegioClientId})`);
  } catch (err) {
    console.warn(`[direct-reminders-webhook] ⚠️ Не вдалося оновити імʼя з records:log для Altegio ID ${altegioClientId}:`, err);
  }
}

/**
 * Отримує токен бота для нагадувань Direct клієнтів (HOB_client_bot)
 */
function getDirectRemindersBotToken(): string {
  return TELEGRAM_ENV.HOB_CLIENT_BOT_TOKEN || TELEGRAM_ENV.BOT_TOKEN;
}

/**
 * Обробка оновлення Instagram username
 */
async function processInstagramUpdate(chatId: number, altegioClientId: number, instagramText: string) {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'direct-reminders-webhook/route.ts:processInstagramUpdate:entry',message:'processInstagramUpdate called',data:{chatId,altegioClientId,instagramText:instagramText?.substring(0,50)},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
  // #endregion
  try {
    console.log(`[direct-reminders-webhook] 🔄 processInstagramUpdate: chatId=${chatId}, altegioClientId=${altegioClientId}, instagramText="${instagramText}"`);
    
    const { updateInstagramForAltegioClient, getDirectClientByAltegioId } = await import('@/lib/direct-store');
    const { normalizeInstagram } = await import('@/lib/normalize');
    
    // Спочатку перевіряємо, чи існує клієнт з таким Altegio ID
    let existingClient = await getDirectClientByAltegioId(altegioClientId);
    console.log(`[direct-reminders-webhook] 🔍 Client lookup by Altegio ID ${altegioClientId}:`, existingClient ? {
      id: existingClient.id,
      instagramUsername: existingClient.instagramUsername,
      state: existingClient.state,
    } : 'NOT FOUND');
    
    // Якщо клієнт не знайдений, спробуємо створити його з Altegio
    if (!existingClient) {
      console.log(`[direct-reminders-webhook] 🔄 Client not found, attempting to create from Altegio...`);
      const botToken = getDirectRemindersBotToken();
      
      try {
        const { getClient } = await import('@/lib/altegio/clients');
        const { getAllDirectStatuses, saveDirectClient } = await import('@/lib/direct-store');
        const companyIdStr = process.env.ALTEGIO_COMPANY_ID || '';
        const companyId = parseInt(companyIdStr, 10);
        
        if (!companyId || Number.isNaN(companyId)) {
          await sendMessage(
            chatId,
            `❌ Клієнт з Altegio ID ${altegioClientId} не знайдено в базі даних.\n\nПомилка: ALTEGIO_COMPANY_ID не налаштовано.`,
            {},
            botToken
          );
          return;
        }
        
        // Отримуємо дані клієнта з Altegio
        const altegioClient = await getClient(companyId, altegioClientId);
        if (!altegioClient) {
          await sendMessage(
            chatId,
            `❌ Клієнт з Altegio ID ${altegioClientId} не знайдено в Altegio.\n\nПеревірте, чи правильно вказано Altegio ID.`,
            {},
            botToken
          );
          return;
        }
        
        // Витягуємо дані з Altegio
        const name = (altegioClient as any)?.name || '';
        const phone = (altegioClient as any)?.phone || null;
        const parts = name.split(/\s+/).filter(Boolean);
        const firstName = parts[0] || '';
        const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
        
        // Отримуємо статус за замовчуванням
        const allStatuses = await getAllDirectStatuses();
        const defaultStatus = allStatuses.find(s => s.isDefault) || allStatuses.find(s => s.id === 'new') || allStatuses[0];
        
        if (!defaultStatus) {
          await sendMessage(
            chatId,
            `❌ Помилка: не знайдено статус за замовчуванням. Зверніться до адміністратора.`,
            {},
            botToken
          );
          return;
        }
        
        // Створюємо нового клієнта
        const now = new Date().toISOString();
        const newClient = {
          id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          instagramUsername: `missing_instagram_${altegioClientId}`, // Тимчасовий, буде оновлено нижче
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          ...(phone && { phone }),
          source: 'instagram' as const,
          state: 'client' as const,
          firstContactDate: now,
          statusId: defaultStatus.id,
          visitedSalon: false,
          signedUpForPaidService: false,
          altegioClientId: altegioClientId,
          createdAt: now,
          updatedAt: now,
        };
        
        await saveDirectClient(newClient, 'telegram-instagram-update-auto-create', { altegioClientId });
        console.log(`[direct-reminders-webhook] ✅ Created Direct client ${newClient.id} from Altegio client ${altegioClientId}`);
        
        // Отримуємо створеного клієнта
        existingClient = await getDirectClientByAltegioId(altegioClientId);
        if (!existingClient) {
          await sendMessage(
            chatId,
            `❌ Помилка: не вдалося створити клієнта. Спробуйте пізніше.`,
            {},
            botToken
          );
          return;
        }
      } catch (err) {
        console.error(`[direct-reminders-webhook] ❌ Failed to create client from Altegio:`, err);
        const botToken = getDirectRemindersBotToken();
        await sendMessage(
          chatId,
          `❌ Клієнт з Altegio ID ${altegioClientId} не знайдено в базі даних.\n\nПомилка при створенні з Altegio: ${err instanceof Error ? err.message : String(err)}`,
          {},
          botToken
        );
        return;
      }
    }
    
    // Перевіряємо, чи це відповідь "ні" (відсутній Instagram)
    const cleanText = instagramText.trim().toLowerCase();
    const isNoResponse = cleanText === 'ні' || cleanText === 'no' || cleanText === 'немає';
    
    if (isNoResponse) {
      // Встановлюємо "NO INSTAGRAM" для клієнта
      const { prisma } = await import('@/lib/prisma');
      const botToken = getDirectRemindersBotToken();
      
      try {
        await prisma.directClient.update({
          where: { id: existingClient.id },
          data: {
            // ВАЖЛИВО: не можна ставити однаковий рядок всім (таблиця дедуплікує по instagramUsername).
            // Тому зберігаємо як унікальний токен.
            instagramUsername: `no_instagram_${altegioClientId}`,
            updatedAt: new Date(),
          },
        });
        
        await sendMessage(
          chatId,
          `✅ Оновлено!\n\n` +
          `Altegio ID: ${altegioClientId}\n` +
          `Instagram: NO INSTAGRAM\n\n` +
          `Клієнт позначено як такий, що не має Instagram акаунту.`,
          {},
          botToken
        );
        console.log(`[direct-reminders-webhook] ✅ Set Instagram to "NO INSTAGRAM" for client ${existingClient.id} (Altegio ID: ${altegioClientId})`);
        return;
      } catch (err) {
        console.error(`[direct-reminders-webhook] ❌ Failed to update client with NO INSTAGRAM:`, err);
        await sendMessage(
          chatId,
          `❌ Помилка при оновленні. Спробуйте пізніше.`,
          {},
          botToken
        );
        return;
      }
    }
    
    // Витягуємо Instagram username (може бути з @ або без)
    const cleanInstagram = instagramText.trim().replace(/^@/, '').split(/\s+/)[0];
    console.log(`[direct-reminders-webhook] Clean Instagram text: "${cleanInstagram}"`);
    
    const normalized = normalizeInstagram(cleanInstagram);
    console.log(`[direct-reminders-webhook] Normalized Instagram: "${normalized}"`);
    
    if (!normalized) {
      const botToken = getDirectRemindersBotToken();
      await sendMessage(
        chatId,
        `❌ Невірний формат Instagram username. Будь ласка, введіть правильний username (наприклад: username або @username).\n\nАбо відправте "ні", якщо у клієнта немає Instagram.`,
        {},
        botToken
      );
      return;
    }
    
    const botToken = getDirectRemindersBotToken();
    
    // 🔥🔥🔥 VERSION 2025-12-28-1735 - Check BEFORE update 🔥🔥🔥
    console.log(`[direct-reminders-webhook] 🔥🔥🔥 VERSION 2025-12-28-1735 - Starting pre-check for Instagram "${normalized}" 🔥🔥🔥`);
    
    // Спочатку перевіряємо, чи існує клієнт з таким Instagram username
    // Якщо так, об'єднуємо їх ПЕРЕД спробою оновлення (щоб уникнути unique constraint error)
    const { getDirectClientByInstagram } = await import('@/lib/direct-store');
    const { prisma } = await import('@/lib/prisma');
    
    const clientByInstagram = await getDirectClientByInstagram(normalized);
    console.log(`[direct-reminders-webhook] 🔍 Checking for existing client with Instagram "${normalized}":`, clientByInstagram ? {
      id: clientByInstagram.id,
      instagramUsername: clientByInstagram.instagramUsername,
      altegioClientId: clientByInstagram.altegioClientId,
      state: clientByInstagram.state,
    } : 'NOT FOUND');
    
    // Якщо знайдено іншого клієнта з таким Instagram, об'єднуємо їх
    // ВАЖЛИВО: завжди залишаємо клієнта з Altegio (existingClient), а не з ManyChat (clientByInstagram)
    // Це гарантує, що ім'я, прізвище та телефон будуть з Altegio
    if (clientByInstagram && clientByInstagram.id !== existingClient.id) {
      console.log(`[direct-reminders-webhook] ⚠️ Found existing client ${clientByInstagram.id} with Instagram "${normalized}", merging BEFORE update...`);
      console.log(`[direct-reminders-webhook] 🔄 MERGE STRATEGY: Keeping Altegio client ${existingClient.id}, deleting ManyChat client ${clientByInstagram.id}`);
      
      try {
        // Оновлюємо клієнта з Altegio: додаємо Instagram username з ManyChat клієнта
        const mergeUpdateData: any = {
          instagramUsername: normalized, // Переносимо Instagram з ManyChat клієнта
          updatedAt: new Date(),
        };
        
        // Ім'я та прізвище залишаємо з Altegio (existingClient) - вони вже правильні
        // Телефон також залишаємо з Altegio (existingClient) - він вже правильний
        
        // Оновлюємо стан на 'client', якщо клієнт мав missing_instagram_*
        const hadMissingInstagram = existingClient.instagramUsername?.startsWith('missing_instagram_') || 
                                    existingClient.instagramUsername?.startsWith('no_instagram_');
        if (hadMissingInstagram) {
          mergeUpdateData.state = 'client';
          console.log(`[direct-reminders-webhook] Updating state to 'client' for Altegio client ${existingClient.id} (had missing_instagram_*, now has real Instagram)`);
        }
        
        // Переносимо історію повідомлень та станів з ManyChat клієнта до Altegio клієнта (якщо потрібно)
        // Але залишаємо основні дані (ім'я, телефон) з Altegio
        try {
          const { moveClientHistory } = await import('@/lib/direct-store');
          const moved = await moveClientHistory(clientByInstagram.id, existingClient.id);
          if (moved.movedMessages > 0 || moved.movedStateLogs > 0) {
            console.log(`[direct-reminders-webhook] ✅ Перенесено історію з ${clientByInstagram.id} → ${existingClient.id}: messages=${moved.movedMessages}, stateLogs=${moved.movedStateLogs}`);
          }
        } catch (historyErr) {
          console.warn('[direct-reminders-webhook] ⚠️ Не вдалося перенести історію повідомлень/станів (не критично):', historyErr);
        }
        
        // Переносимо аватарку з ManyChat клієнта до Altegio клієнта (якщо вона є)
        try {
          const { kvRead, kvWrite } = await import('@/lib/kv');
          const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
          const oldUsername = clientByInstagram.instagramUsername;
          const newUsername = normalized;
          
          if (oldUsername && oldUsername !== newUsername && 
              !oldUsername.startsWith('missing_instagram_') && 
              !oldUsername.startsWith('no_instagram_')) {
            const oldKey = directAvatarKey(oldUsername);
            const newKey = directAvatarKey(newUsername);
            
            try {
              const oldAvatar = await kvRead.getRaw(oldKey);
              if (oldAvatar && typeof oldAvatar === 'string' && /^https?:\/\//i.test(oldAvatar.trim())) {
                // Перевіряємо, чи вже є аватарка для нового username
                const existingNewAvatar = await kvRead.getRaw(newKey);
                if (!existingNewAvatar || typeof existingNewAvatar !== 'string' || !/^https?:\/\//i.test(existingNewAvatar.trim())) {
                  // Копіюємо аватарку на новий ключ
                  await kvWrite.setRaw(newKey, oldAvatar);
                  console.log(`[direct-reminders-webhook] ✅ Перенесено аватарку з "${oldUsername}" → "${newUsername}"`);
                } else {
                  console.log(`[direct-reminders-webhook] ℹ️ Аватарка для "${newUsername}" вже існує, не перезаписуємо`);
                }
              }
            } catch (avatarErr) {
              console.warn('[direct-reminders-webhook] ⚠️ Не вдалося перенести аватарку (не критично):', avatarErr);
            }
          }
        } catch (avatarErr) {
          console.warn('[direct-reminders-webhook] ⚠️ Помилка при спробі перенести аватарку (не критично):', avatarErr);
        }
        
        // ВАЖЛИВО: Спочатку видаляємо ManyChat клієнта, щоб уникнути конфлікту unique constraint
        // Потім оновлюємо Altegio клієнта з новим Instagram username
        console.log(`[direct-reminders-webhook] Deleting duplicate ManyChat client ${clientByInstagram.id} (keeping Altegio client ${existingClient.id})`);
        await prisma.directClient.delete({
          where: { id: clientByInstagram.id },
        });
        
        // Тепер оновлюємо клієнта з Altegio (після видалення ManyChat клієнта)
        const mergedClientDb = await prisma.directClient.update({
          where: { id: existingClient.id },
          data: mergeUpdateData,
        });
        
        // Конвертуємо в DirectClient формат - використовуємо дані з mergedClientDb (вже оновлені в БД)
        const updatedClient: any = {
          ...existingClient,
          instagramUsername: mergedClientDb.instagramUsername,
          firstName: mergedClientDb.firstName || existingClient.firstName,
          lastName: mergedClientDb.lastName || existingClient.lastName,
          phone: mergedClientDb.phone || existingClient.phone, // Телефон з Altegio
          state: mergedClientDb.state as any,
          altegioClientId: mergedClientDb.altegioClientId || existingClient.altegioClientId,
          firstContactDate: mergedClientDb.firstContactDate.toISOString(),
          createdAt: mergedClientDb.createdAt.toISOString(),
          updatedAt: mergedClientDb.updatedAt.toISOString(),
          consultationDate: mergedClientDb.consultationDate?.toISOString() || undefined,
          visitDate: mergedClientDb.visitDate?.toISOString() || undefined,
          paidServiceDate: mergedClientDb.paidServiceDate?.toISOString() || undefined,
          lastMessageAt: mergedClientDb.lastMessageAt?.toISOString() || undefined,
        };
        
        console.log(`[direct-reminders-webhook] ✅ Merged clients BEFORE update: kept Altegio client ${existingClient.id}, deleted ManyChat client ${clientByInstagram.id}`);
        console.log(`[direct-reminders-webhook] 📊 Final client data: name="${updatedClient.firstName} ${updatedClient.lastName}", phone="${updatedClient.phone || 'not set'}", instagram="${updatedClient.instagramUsername}"`);
        
        // Якщо імʼя плейсхолдерне ({{full_name}}) — підтягуємо з records:log
        await tryFixClientNameFromRecordsLog(altegioClientId, existingClient.id);

        // Відправляємо успішне повідомлення
        await sendMessage(
          chatId,
          `✅ Instagram username оновлено!\n\n` +
          `Altegio ID: ${altegioClientId}\n` +
          `Instagram: ${normalized}\n\n` +
          `Тепер всі вебхуки для цього клієнта будуть оброблятися правильно.`,
          {},
          botToken
        );
        console.log(`[direct-reminders-webhook] ✅ Updated Instagram for Altegio client ${altegioClientId} to ${normalized} (merged)`);
        return;
      } catch (mergeErr) {
        console.error(`[direct-reminders-webhook] ❌ Failed to merge clients BEFORE update:`, mergeErr);
        // Продовжуємо зі звичайним оновленням
      }
    }
    
    console.log(`[direct-reminders-webhook] 📞 Calling updateInstagramForAltegioClient(${altegioClientId}, "${normalized}")`);
    let updatedClient = await updateInstagramForAltegioClient(altegioClientId, normalized);
    console.log(`[direct-reminders-webhook] ✅ Update result:`, updatedClient ? {
      success: true,
      clientId: updatedClient.id,
      instagramUsername: updatedClient.instagramUsername,
      state: updatedClient.state,
      altegioClientId: updatedClient.altegioClientId,
    } : { success: false, reason: 'updateInstagramForAltegioClient returned null' });
    
    // Якщо оновлення не вдалося через unique constraint, спробуємо об'єднати клієнтів вручну
    if (!updatedClient) {
      console.log(`[direct-reminders-webhook] 🔥🔥🔥 FALLBACK TRIGGERED - updateInstagramForAltegioClient returned null, trying to merge clients manually... 🔥🔥🔥`);
      const { getDirectClientByInstagram } = await import('@/lib/direct-store');
      const { prisma } = await import('@/lib/prisma');
      
      // Шукаємо клієнта з таким Instagram username
      const clientByInstagram = await getDirectClientByInstagram(normalized);
      
      if (clientByInstagram && clientByInstagram.id !== existingClient.id) {
        console.log(`[direct-reminders-webhook] ⚠️ Found existing client ${clientByInstagram.id} with Instagram "${normalized}", merging (fallback)...`);
        console.log(`[direct-reminders-webhook] 🔄 MERGE STRATEGY (fallback): Keeping Altegio client ${existingClient.id}, deleting ManyChat client ${clientByInstagram.id}`);
        
        try {
          // Оновлюємо клієнта з Altegio: додаємо Instagram username з ManyChat клієнта
          const mergeUpdateData: any = {
            instagramUsername: normalized, // Переносимо Instagram з ManyChat клієнта
            updatedAt: new Date(),
          };
          
          // Ім'я та прізвище залишаємо з Altegio (existingClient) - вони вже правильні
          // Телефон також залишаємо з Altegio (existingClient) - він вже правильний
          
          // Оновлюємо стан на 'client', якщо клієнт мав missing_instagram_*
          const hadMissingInstagram = existingClient.instagramUsername?.startsWith('missing_instagram_') || 
                                      existingClient.instagramUsername?.startsWith('no_instagram_');
          if (hadMissingInstagram) {
            mergeUpdateData.state = 'client';
            console.log(`[direct-reminders-webhook] Updating state to 'client' for Altegio client ${existingClient.id} (had missing_instagram_*, now has real Instagram)`);
          }
          
          // Переносимо історію повідомлень та станів з ManyChat клієнта до Altegio клієнта (якщо потрібно)
          try {
            const { moveClientHistory } = await import('@/lib/direct-store');
            const moved = await moveClientHistory(clientByInstagram.id, existingClient.id);
            if (moved.movedMessages > 0 || moved.movedStateLogs > 0) {
              console.log(`[direct-reminders-webhook] ✅ Перенесено історію з ${clientByInstagram.id} → ${existingClient.id}: messages=${moved.movedMessages}, stateLogs=${moved.movedStateLogs}`);
            }
          } catch (historyErr) {
            console.warn('[direct-reminders-webhook] ⚠️ Не вдалося перенести історію повідомлень/станів (не критично):', historyErr);
          }
          
          // Переносимо аватарку з ManyChat клієнта до Altegio клієнта (якщо вона є)
          try {
            const { kvRead, kvWrite } = await import('@/lib/kv');
            const directAvatarKey = (username: string) => `direct:ig-avatar:${username.toLowerCase()}`;
            const oldUsername = clientByInstagram.instagramUsername;
            const newUsername = normalized;
            
            if (oldUsername && oldUsername !== newUsername && 
                !oldUsername.startsWith('missing_instagram_') && 
                !oldUsername.startsWith('no_instagram_')) {
              const oldKey = directAvatarKey(oldUsername);
              const newKey = directAvatarKey(newUsername);
              
              try {
                const oldAvatar = await kvRead.getRaw(oldKey);
                if (oldAvatar && typeof oldAvatar === 'string' && /^https?:\/\//i.test(oldAvatar.trim())) {
                  // Перевіряємо, чи вже є аватарка для нового username
                  const existingNewAvatar = await kvRead.getRaw(newKey);
                  if (!existingNewAvatar || typeof existingNewAvatar !== 'string' || !/^https?:\/\//i.test(existingNewAvatar.trim())) {
                    // Копіюємо аватарку на новий ключ
                    await kvWrite.setRaw(newKey, oldAvatar);
                    console.log(`[direct-reminders-webhook] ✅ Перенесено аватарку з "${oldUsername}" → "${newUsername}" (fallback)`);
                  } else {
                    console.log(`[direct-reminders-webhook] ℹ️ Аватарка для "${newUsername}" вже існує, не перезаписуємо (fallback)`);
                  }
                }
              } catch (avatarErr) {
                console.warn('[direct-reminders-webhook] ⚠️ Не вдалося перенести аватарку (не критично, fallback):', avatarErr);
              }
            }
          } catch (avatarErr) {
            console.warn('[direct-reminders-webhook] ⚠️ Помилка при спробі перенести аватарку (не критично, fallback):', avatarErr);
          }
          
          // ВАЖЛИВО: Спочатку видаляємо ManyChat клієнта, щоб уникнути конфлікту unique constraint
          // Потім оновлюємо Altegio клієнта з новим Instagram username
          console.log(`[direct-reminders-webhook] Deleting duplicate ManyChat client ${clientByInstagram.id} (keeping Altegio client ${existingClient.id})`);
          await prisma.directClient.delete({
            where: { id: clientByInstagram.id },
          });
          
          // Тепер оновлюємо клієнта з Altegio (після видалення ManyChat клієнта)
          const mergedClientDb = await prisma.directClient.update({
            where: { id: existingClient.id },
            data: mergeUpdateData,
          });
          
          // Конвертуємо в DirectClient формат - використовуємо дані з mergedClientDb (вже оновлені в БД)
          updatedClient = {
            ...existingClient,
            instagramUsername: mergedClientDb.instagramUsername,
            firstName: mergedClientDb.firstName || existingClient.firstName,
            lastName: mergedClientDb.lastName || existingClient.lastName,
            phone: mergedClientDb.phone || existingClient.phone, // Телефон з Altegio
            state: mergedClientDb.state as any,
            altegioClientId: mergedClientDb.altegioClientId || existingClient.altegioClientId,
            firstContactDate: mergedClientDb.firstContactDate.toISOString(),
            createdAt: mergedClientDb.createdAt.toISOString(),
            updatedAt: mergedClientDb.updatedAt.toISOString(),
            consultationDate: mergedClientDb.consultationDate?.toISOString() || undefined,
            visitDate: mergedClientDb.visitDate?.toISOString() || undefined,
            paidServiceDate: mergedClientDb.paidServiceDate?.toISOString() || undefined,
            lastMessageAt: mergedClientDb.lastMessageAt?.toISOString() || undefined,
          } as any;
          
          console.log(`[direct-reminders-webhook] ✅ Merged clients (fallback): kept Altegio client ${existingClient.id}, deleted ManyChat client ${clientByInstagram.id}`);
          console.log(`[direct-reminders-webhook] 📊 Final client data: name="${updatedClient.firstName} ${updatedClient.lastName}", phone="${updatedClient.phone || 'not set'}", instagram="${updatedClient.instagramUsername}"`);
        } catch (mergeErr) {
          console.error(`[direct-reminders-webhook] ❌ Failed to merge clients:`, mergeErr);
        }
      }
    }
    
    if (updatedClient) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'direct-reminders-webhook/route.ts:processInstagramUpdate:before-send',message:'Instagram updated, about to send confirmation',data:{altegioClientId,normalized,chatId},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      // Якщо імʼя плейсхолдерне ({{full_name}}) — підтягуємо з records:log
      await tryFixClientNameFromRecordsLog(altegioClientId, updatedClient.id);
      await sendMessage(
        chatId,
        `✅ Instagram username оновлено!\n\n` +
        `Altegio ID: ${altegioClientId}\n` +
        `Instagram: ${normalized}\n\n` +
        `Тепер всі вебхуки для цього клієнта будуть оброблятися правильно.`,
        {},
        botToken
      );
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'direct-reminders-webhook/route.ts:processInstagramUpdate:after-send',message:'Confirmation sent successfully',data:{altegioClientId,normalized},timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      console.log(`[direct-reminders-webhook] ✅ Updated Instagram for Altegio client ${altegioClientId} to ${normalized}`);
    } else {
      await sendMessage(
        chatId,
        `❌ Не вдалося оновити Instagram username. Перевірте, чи існує клієнт з Altegio ID ${altegioClientId}.`,
        {},
        botToken
      );
      console.error(`[direct-reminders-webhook] ❌ Failed to update Instagram - client not found or update failed`);
    }
  } catch (err) {
    console.error(`[direct-reminders-webhook] Failed to update Instagram for Altegio client ${altegioClientId}:`, err);
    const botToken = getDirectRemindersBotToken();
    await sendMessage(
      chatId,
      `❌ Помилка при оновленні Instagram username: ${err instanceof Error ? err.message : String(err)}`,
      {},
      botToken
    );
  }
}

/**
 * Обробка callback для вибору майстра
 */
async function handleChangeMasterCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  reminderId: string
) {
  try {
    console.log(`[direct-reminders-webhook] Handling change master callback for reminder ${reminderId}`);
    
    const { getDirectReminder } = await import('@/lib/direct-reminders/store');
    const { getDirectMastersForSelection } = await import('@/lib/direct-masters/store');
    
    const reminder = await getDirectReminder(reminderId);
    if (!reminder) {
      console.warn(`[direct-reminders-webhook] Reminder ${reminderId} not found`);
      const botToken = getDirectRemindersBotToken();
      await answerCallbackQuery(callback.id, {
        text: 'Нагадування не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    // Отримуємо відповідальних з бази даних (вже відфільтровані)
    const masters = await getDirectMastersForSelection();
    console.log(`[direct-reminders-webhook] Found ${masters.length} masters from database`);
    
    const botToken = getDirectRemindersBotToken();
    
    if (masters.length === 0) {
      await answerCallbackQuery(callback.id, {
        text: 'Відповідальних не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;

    if (!chatId || !messageId) {
      console.error(`[direct-reminders-webhook] Missing chatId or messageId: chatId=${chatId}, messageId=${messageId}`);
      await answerCallbackQuery(callback.id, {
        text: 'Помилка: не вдалося отримати дані повідомлення',
        show_alert: true,
      }, botToken);
      return;
    }

    // Створюємо кнопки з майстрами (по 2 в рядку)
    const masterButtons: any[][] = [];
    for (let i = 0; i < masters.length; i += 2) {
      const row = masters.slice(i, i + 2).map(master => ({
        text: `👤 ${master.name}`,
        callback_data: `direct_reminder:${reminderId}:select-master-${master.id}`,
      }));
      masterButtons.push(row);
    }
    
    // Додаємо кнопку "Назад"
    masterButtons.push([
      { text: '◀️ Назад', callback_data: `direct_reminder:${reminderId}:back` },
    ]);

    const keyboard = {
      inline_keyboard: masterButtons,
    };

    // Отримуємо текст повідомлення (може бути в text або caption)
    const messageText = callback.message?.text || callback.message?.caption || '';

    console.log(`[direct-reminders-webhook] Updating message ${messageId} in chat ${chatId} with ${masters.length} masters`);

    // Оновлюємо повідомлення з кнопками майстрів
    await editMessageText(chatId, messageId, messageText, {
      reply_markup: keyboard,
    }, botToken);

    await answerCallbackQuery(callback.id, {
      text: `Оберіть відповідального (${masters.length} доступно)`,
    }, botToken);
    
    console.log(`[direct-reminders-webhook] ✅ Successfully updated message with master selection`);
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Failed to handle change master callback:`, err);
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callback.id, {
      text: `Помилка обробки вибору майстра: ${err instanceof Error ? err.message : String(err)}`,
      show_alert: true,
    }, botToken);
  }
}

/**
 * Обробка вибору конкретного майстра
 */
async function handleSelectMasterCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  reminderId: string,
  masterId: string
) {
  try {
    const { getDirectReminder, saveDirectReminder } = await import('@/lib/direct-reminders/store');
    const { getAllDirectClients, saveDirectClient } = await import('@/lib/direct-store');
    const { getDirectMasterById } = await import('@/lib/direct-masters/store');
    
    const botToken = getDirectRemindersBotToken();
    
    const reminder = await getDirectReminder(reminderId);
    if (!reminder) {
      await answerCallbackQuery(callback.id, {
        text: 'Нагадування не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    const master = await getDirectMasterById(masterId);
    if (!master) {
      await answerCallbackQuery(callback.id, {
        text: 'Відповідального не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }
    
    // Перевіряємо, чи майстер має role='master' (не адміністратор або дірект-менеджер)
    if (master.role !== 'master') {
      await answerCallbackQuery(callback.id, {
        text: `Помилка: "${master.name}" не є майстром (роль: ${master.role}). В колонку "Майстер" можна вносити лише майстрів.`,
        show_alert: true,
      }, botToken);
      return;
    }

    // Оновлюємо майстра клієнта
    const directClients = await getAllDirectClients();
    const directClient = directClients.find(c => c.id === reminder.directClientId);
    
    if (directClient) {
      const updated: typeof directClient = {
        ...directClient,
        masterId: master.id,
        updatedAt: new Date().toISOString(),
      };
      await saveDirectClient(updated);
      console.log(`[direct-reminders-webhook] ✅ Updated Direct client ${directClient.id} master to '${master.name}' (${master.id}) from reminder ${reminderId}`);
    }

    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;

    if (chatId && messageId) {
      // Повертаємо оригінальні кнопки
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Все чудово', callback_data: `direct_reminder:${reminderId}:all-good` },
            { text: '💰 За дорого', callback_data: `direct_reminder:${reminderId}:too-expensive` },
          ],
          [
            { text: '📞 Недодзвон', callback_data: `direct_reminder:${reminderId}:no-call` },
            { text: '👤 Заміна відповідального', callback_data: `direct_reminder:${reminderId}:change-master` },
          ],
        ],
      };

      await editMessageText(chatId, messageId, callback.message?.text || '', {
        reply_markup: keyboard,
      }, botToken);
    }

    await answerCallbackQuery(callback.id, {
      text: `✅ Відповідального змінено на: ${master.name}`,
    }, botToken);
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Failed to handle select master callback:`, err);
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callback.id, {
      text: 'Помилка обробки вибору майстра',
      show_alert: true,
    }, botToken);
  }
}

/**
 * Обробка кнопки "Назад" - повертає оригінальні кнопки
 */
async function handleBackCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  reminderId: string
) {
  try {
    const botToken = getDirectRemindersBotToken();
    
    const chatId = callback.message?.chat.id;
    const messageId = callback.message?.message_id;

    if (!chatId || !messageId) {
      await answerCallbackQuery(callback.id, {
        text: 'Помилка: не вдалося отримати дані повідомлення',
        show_alert: true,
      }, botToken);
      return;
    }

    // Повертаємо оригінальні кнопки
    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ Все чудово', callback_data: `direct_reminder:${reminderId}:all-good` },
          { text: '💰 За дорого', callback_data: `direct_reminder:${reminderId}:too-expensive` },
        ],
        [
          { text: '📞 Недодзвон', callback_data: `direct_reminder:${reminderId}:no-call` },
          { text: '👤 Заміна відповідального', callback_data: `direct_reminder:${reminderId}:change-master` },
        ],
      ],
    };

    await editMessageText(chatId, messageId, callback.message?.text || '', {
      reply_markup: keyboard,
    }, botToken);

    await answerCallbackQuery(callback.id, {
      text: 'Повернуто до головного меню',
    }, botToken);
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Failed to handle back callback:`, err);
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callback.id, {
      text: 'Помилка обробки',
      show_alert: true,
    }, botToken);
  }
}

/**
 * Обробка callback для Direct нагадувань
 */
async function handleDirectReminderCallback(
  callbackId: string,
  reminderId: string,
  status: 'all-good' | 'too-expensive' | 'no-call'
) {
  try {
    const { getDirectReminder, saveDirectReminder } = await import('@/lib/direct-reminders/store');
    const { getAllDirectClients, saveDirectClient } = await import('@/lib/direct-store');
    
    const botToken = getDirectRemindersBotToken();
    
    const reminder = await getDirectReminder(reminderId);
    if (!reminder) {
      await answerCallbackQuery(callbackId, {
        text: 'Нагадування не знайдено',
        show_alert: true,
      }, botToken);
      return;
    }

    // Оновлюємо статус нагадування
    reminder.status = status;
    reminder.updatedAt = new Date().toISOString();
    
    if (status === 'all-good' || status === 'too-expensive') {
      reminder.status = status;
      // Оновлюємо стан клієнта в Direct Manager
      const directClients = await getAllDirectClients();
      const directClient = directClients.find(c => c.id === reminder.directClientId);
      
      if (directClient) {
        const clientState: 'all-good' | 'too-expensive' = status === 'all-good' ? 'all-good' : 'too-expensive';
        const updated: typeof directClient = {
          ...directClient,
          state: clientState,
          updatedAt: new Date().toISOString(),
        };
        await saveDirectClient(updated);
        console.log(`[direct-reminders-webhook] ✅ Updated Direct client ${directClient.id} state to '${clientState}' from reminder ${reminderId}`);
      }
      
      await answerCallbackQuery(callbackId, {
        text: status === 'all-good' ? '✅ Статус оновлено: Все чудово' : '💰 Статус оновлено: За дорого',
      }, botToken);
    } else if (status === 'no-call') {
      reminder.status = 'no-call';
      reminder.lastReminderAt = new Date().toISOString();
      // Наступне нагадування буде надіслано через 2 години (обробляється в cron)
      
      await answerCallbackQuery(callbackId, {
        text: '📞 Нагадування буде надіслано повторно через 2 години',
      }, botToken);
    }
    
    await saveDirectReminder(reminder);
    console.log(`[direct-reminders-webhook] ✅ Updated reminder ${reminderId} status to '${status}'`);
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Failed to handle Direct reminder callback:`, err);
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callbackId, {
      text: 'Помилка обробки нагадування',
      show_alert: true,
    }, botToken);
  }
}

async function handleCallback(callback: NonNullable<TelegramUpdate["callback_query"]>) {
  const data = callback.data || "";
  const chatId = callback.message?.chat.id;

  if (!chatId) {
    const botToken = getDirectRemindersBotToken();
    await answerCallbackQuery(callback.id, {
      text: "Не вдалося обробити дію",
      show_alert: true,
    }, botToken);
    return;
  }

  // Обробка callback для Direct нагадувань
  if (data.startsWith('direct_reminder:')) {
    const parts = data.split(':');
    if (parts.length === 3) {
      const [, reminderId, action] = parts;
      
      // Обробка вибору майстра
      if (action === 'change-master') {
        await handleChangeMasterCallback(callback, reminderId);
        return;
      }
      
      // Обробка вибору конкретного майстра
      if (action.startsWith('select-master-')) {
        const masterId = action.replace('select-master-', '');
        await handleSelectMasterCallback(callback, reminderId, masterId);
        return;
      }
      
      // Обробка кнопки "Назад"
      if (action === 'back') {
        await handleBackCallback(callback, reminderId);
        return;
      }
      
      // Обробка стандартних статусів
      await handleDirectReminderCallback(callback.id, reminderId, action as 'all-good' | 'too-expensive' | 'no-call');
      return;
    }
  }

  // Якщо це не callback для Direct нагадувань - ігноруємо
  const botToken = getDirectRemindersBotToken();
  await answerCallbackQuery(callback.id, {
    text: 'Невідома дія',
  }, botToken);
}

async function handleMessage(message: TelegramUpdate["message"]) {
  console.log(`[direct-reminders-webhook] handleMessage: FUNCTION CALLED - VERSION 2025-12-28-1127`);
  try {
    console.log(`[direct-reminders-webhook] handleMessage: INSIDE TRY BLOCK - VERSION 2025-12-28-1127`);
  if (!message) {
    console.log(`[direct-reminders-webhook] handleMessage: message is null/undefined`);
    return;
  }
    console.log(`[direct-reminders-webhook] handleMessage: message exists, getting chatId`);
  const chatId = message.chat.id;
  const fromUser = message.from;
    console.log(`[direct-reminders-webhook] handleMessage STEP 1: chatId=${chatId}, hasText=${!!message.text}, hasReply=${!!message.reply_to_message}`);
    console.log(`[direct-reminders-webhook] handleMessage STEP 2: fromUsername=${fromUser?.username}, fromUserId=${fromUser?.id}`);
    console.log(`[direct-reminders-webhook] handleMessage STEP 3: before messageText assignment`);
    
    const messageText = message.text;
    console.log(`[direct-reminders-webhook] handleMessage STEP 4: messageText="${messageText}", type=${typeof messageText}, startsWith="/start"=${messageText?.startsWith("/start")}`);

  // Обробка команди /start - реєстрація та автоматичне оновлення chatId в DirectMaster
    if (messageText?.startsWith("/start")) {
    console.log(`[direct-reminders-webhook] 🔵 Processing /start command from chatId=${chatId}, username=${fromUser?.username}, userId=${fromUser?.id}`);
    console.log(`[direct-reminders-webhook] Full user object:`, JSON.stringify(fromUser, null, 2));
    
    try {
      const { getMasterByTelegramUsername, getAllDirectMasters, saveDirectMaster } = await import('@/lib/direct-masters/store');
      
      // Шукаємо майстра за Telegram username
      if (fromUser?.username) {
        console.log(`[direct-reminders-webhook] 🔍 Searching for master with username: "${fromUser.username}"`);
        const directMaster = await getMasterByTelegramUsername(fromUser.username);
        console.log(`[direct-reminders-webhook] 🔍 Search result:`, directMaster ? {
          id: directMaster.id,
          name: directMaster.name,
          telegramUsername: directMaster.telegramUsername,
          telegramChatId: directMaster.telegramChatId,
        } : 'NOT FOUND');
        
        if (directMaster) {
          // Оновлюємо chatId в DirectMaster
          const updated = {
            ...directMaster,
            telegramChatId: chatId,
            updatedAt: new Date().toISOString(),
          };
          await saveDirectMaster(updated);
          console.log(`[direct-reminders-webhook] ✅ Updated DirectMaster ${directMaster.name} (@${fromUser.username}) with chatId: ${chatId}`);
          
          const botToken = getDirectRemindersBotToken();
          await sendMessage(
            chatId,
            `Привіт, ${directMaster.name}!\n\n` +
            `Ваш Telegram Chat ID (${chatId}) було автоматично збережено в системі.\n\n` +
            `Тепер ви будете отримувати повідомлення про відсутній Instagram username для клієнтів.`,
            {},
            botToken
          );
        } else {
          // Якщо не знайдено в DirectMaster, перевіряємо всіх майстрів
          const allMasters = await getAllDirectMasters();
          const masterByUsername = allMasters.find(m => 
            m.telegramUsername?.toLowerCase().replace(/^@/, '') === fromUser.username.toLowerCase()
          );
          
          if (masterByUsername) {
            // Оновлюємо chatId
            const updated = {
              ...masterByUsername,
              telegramChatId: chatId,
              updatedAt: new Date().toISOString(),
            };
            await saveDirectMaster(updated);
            console.log(`[direct-reminders-webhook] ✅ Updated DirectMaster ${masterByUsername.name} (@${fromUser.username}) with chatId: ${chatId}`);
            
            const botToken = getDirectRemindersBotToken();
            await sendMessage(
              chatId,
              `Привіт, ${masterByUsername.name}!\n\n` +
              `Ваш Telegram Chat ID (${chatId}) було автоматично збережено в системі.\n\n` +
              `Тепер ви будете отримувати повідомлення про відсутній Instagram username для клієнтів.`,
              {},
              botToken
            );
          } else {
            console.log(`[direct-reminders-webhook] ⚠️ No DirectMaster found for username @${fromUser.username}`);
            const botToken = getDirectRemindersBotToken();
            await sendMessage(
              chatId,
              `Привіт! Я не знайшов ваш профіль у системі Direct Manager.\n\n` +
              `Якщо ви адміністратор або майстер, будь ласка, повідомте адміністратору для додавання вашого профілю.`,
              {},
              botToken
            );
          }
        }
      } else {
        console.log(`[direct-reminders-webhook] ⚠️ /start command received but username is missing`);
        const botToken = getDirectRemindersBotToken();
        await sendMessage(
          chatId,
          `Привіт! Для реєстрації потрібен ваш Telegram username. Будь ласка, встановіть username в налаштуваннях Telegram.`,
          {},
          botToken
        );
      }
    } catch (err) {
      console.error(`[direct-reminders-webhook] Error processing /start command:`, err);
      const botToken = getDirectRemindersBotToken();
      await sendMessage(
        chatId,
        `Помилка при реєстрації. Будь ласка, спробуйте пізніше або зверніться до адміністратора.`,
        {},
        botToken
      );
    }
    return;
  }

    if (messageText) {
    // Обробка відповіді на повідомлення про відсутній Instagram
    if (message.reply_to_message?.text) {
      const repliedText = message.reply_to_message.text;
      console.log(`[direct-reminders-webhook] Processing reply message. Full replied text:`, repliedText);
      console.log(`[direct-reminders-webhook] Reply text length: ${repliedText.length}`);
      
      // Перевіряємо, чи це відповідь на повідомлення про відсутній Instagram
      if (repliedText.includes('Відсутній Instagram username') && repliedText.includes('Altegio ID:')) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'direct-reminders-webhook/route.ts:reply-detected',message:'Reply to missing Instagram detected',data:{messageText:messageText?.substring(0,80),repliedTextLen:repliedText?.length},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        console.log(`[direct-reminders-webhook] Detected reply to missing Instagram notification`);
        
        // Витягуємо Altegio ID з повідомлення (пробуємо різні формати)
        // Telegram може надсилати HTML, тому перевіряємо різні варіанти
        const altegioIdMatch = repliedText.match(/Altegio ID:\s*<code>(\d+)<\/code>|Altegio ID:\s*<code>(\d+)|Altegio ID:\s*(\d+)/);
        console.log(`[direct-reminders-webhook] Altegio ID match:`, altegioIdMatch);
        console.log(`[direct-reminders-webhook] Searching for Altegio ID in text...`);
        
        // Також пробуємо знайти без HTML тегів (на випадок, якщо Telegram надсилає plain text)
        if (!altegioIdMatch) {
          const plainMatch = repliedText.match(/Altegio ID[:\s]+(\d+)/i);
          console.log(`[direct-reminders-webhook] Plain text Altegio ID match:`, plainMatch);
          if (plainMatch) {
            const altegioClientId = parseInt(plainMatch[1], 10);
            if (!isNaN(altegioClientId)) {
              console.log(`[direct-reminders-webhook] Found Altegio ID via plain text: ${altegioClientId}`);
              // Продовжуємо обробку з цим ID
                await processInstagramUpdate(chatId, altegioClientId, messageText.trim());
              return;
            }
          }
        }
        
        if (altegioIdMatch) {
          const altegioClientId = parseInt(altegioIdMatch[1] || altegioIdMatch[2] || altegioIdMatch[3], 10);
          console.log(`[direct-reminders-webhook] Parsed Altegio ID: ${altegioClientId}`);
          
          if (!isNaN(altegioClientId)) {
            // Витягуємо Instagram username з відповіді (може бути з @ або без)
              const instagramText = messageText.trim().replace(/^@/, '').split(/\s+/)[0];
            console.log(`[direct-reminders-webhook] Extracted Instagram text: "${instagramText}"`);
            
            if (instagramText && instagramText.length > 0) {
              await processInstagramUpdate(chatId, altegioClientId, instagramText);
              return;
            } else {
              const botToken = getDirectRemindersBotToken();
              await sendMessage(
                chatId,
                `❌ Будь ласка, введіть Instagram username у відповідь (наприклад: username або @username).`,
                {},
                botToken
              );
              return;
            }
          } else {
            console.error(`[direct-reminders-webhook] Invalid Altegio ID: ${altegioIdMatch[1] || altegioIdMatch[2] || altegioIdMatch[3]}`);
          }
        } else {
          console.error(`[direct-reminders-webhook] ❌ Could not extract Altegio ID from message`);
          console.error(`[direct-reminders-webhook] Replied text was:`, repliedText);
        }
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'direct-reminders-webhook/route.ts:reply-no-match',message:'Reply text does not match expected pattern',data:{hasReply:!!message.reply_to_message?.text,repliedPreview:message.reply_to_message?.text?.substring(0,200),hasMissing:repliedText?.includes('Відсутній Instagram username'),hasAltegio:repliedText?.includes('Altegio ID:')},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
        // #endregion
        console.log(`[direct-reminders-webhook] ⚠️ Message is a reply, but replied text does not contain 'Відсутній Instagram username' or 'Altegio ID:'`);
        console.log(`[direct-reminders-webhook] Replied text preview:`, message.reply_to_message?.text?.substring(0, 200));
      }
    } else if (message.reply_to_message) {
      console.log(`[direct-reminders-webhook] ⚠️ Message is a reply, but reply_to_message.text is missing`);
      console.log(`[direct-reminders-webhook] Reply structure:`, {
        message_id: message.reply_to_message.message_id,
        hasText: !!message.reply_to_message.text,
        hasPhoto: !!message.reply_to_message.photo,
        hasCaption: !!message.reply_to_message.caption,
      });
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'direct-reminders-webhook/route.ts:no-reply',message:'Message is not a reply',data:{messageText:messageText?.substring(0,80),hasReplyToMessage:!!message.reply_to_message},timestamp:Date.now(),hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      console.log(`[direct-reminders-webhook] ℹ️ Message is not a reply (reply_to_message is null/undefined)`);
      console.log(`[direct-reminders-webhook] ⚠️ To update Instagram, you need to REPLY to the message about missing Instagram username`);
      console.log(`[direct-reminders-webhook] Full message structure:`, JSON.stringify(message, null, 2).substring(0, 2000));
      }
    }
  } catch (err) {
    console.error(`[direct-reminders-webhook] ❌ Error in handleMessage:`, err);
    const botToken = getDirectRemindersBotToken();
    try {
      await sendMessage(
        message?.chat.id || 0,
        `❌ Виникла помилка при обробці повідомлення. Будь ласка, спробуйте пізніше.`,
        {},
        botToken
      );
    } catch (sendErr) {
      console.error(`[direct-reminders-webhook] Failed to send error message:`, sendErr);
    }
  }
}

export async function POST(req: NextRequest) {
  console.log(`[direct-reminders-webhook] ==========================================`);
  console.log(`[direct-reminders-webhook] NEW CODE VERSION - 2025-12-28-1145`);
  console.log(`[direct-reminders-webhook] ==========================================`);
  try {
    console.log(`[direct-reminders-webhook] 🔵 Inside POST try block - VERSION 2025-12-28-1138`);
    assertDirectRemindersBotToken();

    const update = (await req.json()) as TelegramUpdate;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'direct-reminders-webhook/route.ts:POST:entry',message:'direct-reminders-webhook received update',data:{updateId:update?.update_id,hasMessage:!!update?.message,messageText:update?.message?.text?.substring(0,100),hasReply:!!update?.message?.reply_to_message,replyTextPreview:update?.message?.reply_to_message?.text?.substring(0,150)},timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    // Зберігаємо повідомлення в KV для перегляду в адмін-панелі
    try {
      const { kvWrite } = await import('@/lib/kv');
      const logEntry = {
        receivedAt: new Date().toISOString(),
        updateId: update.update_id,
        hasMessage: !!update.message,
        hasCallbackQuery: !!update.callback_query,
        messageText: update.message?.text,
        messageChatId: update.message?.chat?.id,
        messageFromUsername: update.message?.from?.username,
        messageFromId: update.message?.from?.id,
        messageFromFirstName: update.message?.from?.first_name,
        messageFromLastName: update.message?.from?.last_name,
        replyToMessage: !!update.message?.reply_to_message,
        replyToMessageId: update.message?.reply_to_message?.message_id,
        replyToMessageText: update.message?.reply_to_message?.text?.substring(0, 500),
        callbackData: update.callback_query?.data,
        fullUpdate: JSON.stringify(update, null, 2),
      };
      const payload = JSON.stringify(logEntry);
      await kvWrite.lpush('telegram:direct-reminders:log', payload);
      // Зберігаємо останні 1000 повідомлень
      await kvWrite.ltrim('telegram:direct-reminders:log', 0, 999);
    } catch (logErr) {
      console.warn('[direct-reminders-webhook] Failed to save message log to KV:', logErr);
    }
    console.log(`[direct-reminders-webhook] ✅ Received update - VERSION 2025-12-28-1138:`, {
      updateId: update.update_id,
      hasMessage: !!update.message,
      hasCallbackQuery: !!update.callback_query,
      messageText: update.message?.text,
      messageChatId: update.message?.chat?.id,
      messageFromUsername: update.message?.from?.username,
      messageFromId: update.message?.from?.id,
      replyToMessage: !!update.message?.reply_to_message,
      replyToMessageId: update.message?.reply_to_message?.message_id,
      replyToMessageText: update.message?.reply_to_message?.text?.substring(0, 100),
      isStartCommand: update.message?.text?.startsWith('/start'),
      fullUpdate: JSON.stringify(update, null, 2).substring(0, 2000), // Перші 2000 символів для діагностики
    });

    // Обробляємо текстові повідомлення (відповіді на повідомлення про відсутній Instagram)
    if (update.message) {
      console.log(`[direct-reminders-webhook] Processing message from chat ${update.message.chat.id}`);
      await handleMessage(update.message);
    }
    
    // Обробляємо callback для Direct нагадувань
    if (update.callback_query) {
      console.log(`[direct-reminders-webhook] Processing callback query`);
      await handleCallback(update.callback_query);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[direct-reminders-webhook] Error processing update:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
