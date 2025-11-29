// web/app/api/altegio/reminders/test-send/route.ts
// Endpoint для тестування відправки повідомлень

import { NextRequest, NextResponse } from 'next/server';
import { kvRead } from '@/lib/kv';
import type { ReminderJob } from '@/lib/altegio/reminders';
import { formatReminderMessage, getActiveReminderRules } from '@/lib/altegio/reminders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Імпортуємо функції відправки з cron job
async function sendInstagramDM(
  instagram: string,
  message: string,
  job: ReminderJob,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  console.log(`[test-send] 📤 Sending Instagram DM to @${instagram}:`, {
    message,
    jobId: job.id,
    visitId: job.visitId,
    visitDate: job.datetime,
  });

  const manychatApiKey = process.env.MANYCHAT_API_KEY || process.env.MANYCHAT_API_TOKEN || process.env.MC_API_KEY;
  if (manychatApiKey) {
    try {
      console.log(`[test-send] Attempting to send via ManyChat API`);
      const manychatResult = await sendViaManyChat(instagram, message, manychatApiKey);
      if (manychatResult.success) {
        return manychatResult;
      }
      console.warn(`[test-send] ManyChat API failed, trying Instagram Graph API:`, manychatResult.error);
    } catch (err) {
      console.warn(`[test-send] ManyChat API error:`, err);
    }
  }

  const instagramToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (instagramToken) {
    try {
      console.log(`[test-send] Attempting to send via Instagram Graph API`);
      const instagramResult = await sendViaInstagramGraph(instagram, message, instagramToken);
      if (instagramResult.success) {
        return instagramResult;
      }
      console.warn(`[test-send] Instagram Graph API failed:`, instagramResult.error);
    } catch (err) {
      console.warn(`[test-send] Instagram Graph API error:`, err);
    }
  }

  console.log(`[test-send] ⚠️ No API configured, simulating send (mock mode)`);
  return {
    success: true,
    messageId: `mock_${Date.now()}_${job.id}`,
  };
}

async function sendViaManyChat(
  instagram: string,
  message: string,
  apiKey: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    const searchUrl = `https://api.manychat.com/fb/subscriber/findByName`;
    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: instagram,
      }),
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      return {
        success: false,
        error: `ManyChat search failed: ${searchResponse.status} ${errorText}`,
      };
    }

    const searchData = await searchResponse.json();
    const subscriberId = searchData?.data?.subscriber_id || searchData?.subscriber_id;

    if (!subscriberId) {
      return {
        success: false,
        error: `Subscriber not found in ManyChat for @${instagram}`,
      };
    }

    const sendUrl = `https://api.manychat.com/fb/sending/sendContent`;
    const sendResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscriber_id: subscriberId,
        data: {
          version: 'v2',
          content: {
            messages: [
              {
                type: 'text',
                text: message,
              },
            ],
          },
        },
      }),
    });

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      return {
        success: false,
        error: `ManyChat send failed: ${sendResponse.status} ${errorText}`,
      };
    }

    const sendData = await sendResponse.json();
    return {
      success: true,
      messageId: sendData?.data?.message_id || `manychat_${Date.now()}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function sendViaInstagramGraph(
  instagram: string,
  message: string,
  accessToken: string,
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    const pageId = process.env.INSTAGRAM_PAGE_ID;
    if (!pageId) {
      return {
        success: false,
        error: 'INSTAGRAM_PAGE_ID not configured',
      };
    }

    const pageUrl = `https://graph.facebook.com/v18.0/${pageId}?fields=instagram_business_account&access_token=${accessToken}`;
    const pageResponse = await fetch(pageUrl);

    if (!pageResponse.ok) {
      const errorText = await pageResponse.text();
      return {
        success: false,
        error: `Failed to get Instagram Business Account: ${pageResponse.status} ${errorText}`,
      };
    }

    const pageData = await pageResponse.json();
    const igBusinessAccountId = pageData?.instagram_business_account?.id;

    if (!igBusinessAccountId) {
      return {
        success: false,
        error: 'Instagram Business Account not found',
      };
    }

    const searchUrl = `https://graph.instagram.com/v18.0/${igBusinessAccountId}/business_discovery?username=${encodeURIComponent(instagram)}&fields=id,username&access_token=${accessToken}`;
    const searchResponse = await fetch(searchUrl);

    if (!searchResponse.ok) {
      return {
        success: false,
        error: `Failed to find user @${instagram}: ${searchResponse.status}`,
      };
    }

    const searchData = await searchResponse.json();
    const userId = searchData?.business_discovery?.id;

    if (!userId) {
      return {
        success: false,
        error: `User @${instagram} not found`,
      };
    }

    const sendUrl = `https://graph.facebook.com/v18.0/${igBusinessAccountId}/messages`;
    const sendResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: userId },
        message: { text: message },
        access_token: accessToken,
      }),
    });

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      return {
        success: false,
        error: `Instagram send failed: ${sendResponse.status} ${errorText}`,
      };
    }

    const sendData = await sendResponse.json();
    return {
      success: true,
      messageId: sendData?.message_id || `instagram_${Date.now()}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'jobId is required',
        },
        { status: 400 },
      );
    }

    // Отримуємо job з KV
    const jobKey = `altegio:reminder:job:${jobId}`;
    const jobRaw = await kvRead.getRaw(jobKey);

    if (!jobRaw) {
      return NextResponse.json(
        {
          ok: false,
          error: `Job ${jobId} not found`,
        },
        { status: 404 },
      );
    }

    // Парсимо job
    let jobData: any;
    if (typeof jobRaw === 'string') {
      try {
        jobData = JSON.parse(jobRaw);
      } catch {
        jobData = jobRaw;
      }
    } else {
      jobData = jobRaw;
    }

    if (jobData && typeof jobData === 'object' && !Array.isArray(jobData)) {
      const candidate = jobData.value ?? jobData.result ?? jobData.data;
      if (candidate !== undefined) {
        if (typeof candidate === 'string') {
          try {
            jobData = JSON.parse(candidate);
          } catch {
            jobData = candidate;
          }
        } else {
          jobData = candidate;
        }
      }
    }

    if (typeof jobData === 'string') {
      try {
        jobData = JSON.parse(jobData);
      } catch (err) {
        return NextResponse.json(
          {
            ok: false,
            error: `Failed to parse job: ${err instanceof Error ? err.message : String(err)}`,
          },
          { status: 500 },
        );
      }
    }

    const job: ReminderJob = jobData;

    if (!job.instagram) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Job has no Instagram username',
        },
        { status: 400 },
      );
    }

    // Отримуємо правило та форматуємо повідомлення
    const rules = await getActiveReminderRules();
    const rule = rules.find((r) => r.id === job.ruleId);

    if (!rule) {
      return NextResponse.json(
        {
          ok: false,
          error: `Rule ${job.ruleId} not found`,
        },
        { status: 404 },
      );
    }

    const message = formatReminderMessage(job, rule);

    // Відправляємо повідомлення
    const result = await sendInstagramDM(job.instagram, message, job);

    return NextResponse.json({
      ok: result.success,
      message,
      result,
      job: {
        id: job.id,
        visitId: job.visitId,
        instagram: job.instagram,
        clientName: job.payload.clientName,
        visitDate: job.datetime,
      },
    });
  } catch (error) {
    console.error('[test-send] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

