// web/app/api/altegio/reminders/rules/route.ts
// API для управління правилами нагадувань (шаблонами повідомлень)

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';
import type { ReminderRule } from '@/lib/altegio/reminders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RULES_KEY = 'altegio:reminder:rules';

// Дефолтні правила (якщо в KV немає)
const DEFAULT_RULES: ReminderRule[] = [
  {
    id: 'before_7d',
    daysBefore: 7,
    active: true,
    channel: 'instagram_dm',
    template: 'Нагадуємо про ваш візит {date} о {time} у Home of Beauty. Чекаємо вас! ❤️',
  },
  {
    id: 'before_3d',
    daysBefore: 3,
    active: true,
    channel: 'instagram_dm',
    template: 'Через {daysLeft} дні(в) у вас запис {date} о {time}. Підготуйтеся до візиту!',
  },
  {
    id: 'before_1d',
    daysBefore: 1,
    active: true,
    channel: 'instagram_dm',
    template: 'Завтра у вас візит {date} о {time}. Чекаємо вас! ❤️',
  },
];

async function getRulesFromKV(): Promise<ReminderRule[]> {
  const rulesRaw = await kvRead.getRaw(RULES_KEY);
  
  if (!rulesRaw) {
    return DEFAULT_RULES;
  }

  try {
    let parsed: any;
    if (typeof rulesRaw === 'string') {
      try {
        parsed = JSON.parse(rulesRaw);
      } catch {
        parsed = rulesRaw;
      }
    } else {
      parsed = rulesRaw;
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const candidate = parsed.value ?? parsed.result ?? parsed.data;
      if (candidate !== undefined) {
        if (typeof candidate === 'string') {
          try {
            parsed = JSON.parse(candidate);
          } catch {
            parsed = candidate;
          }
        } else {
          parsed = candidate;
        }
      }
    }

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.warn('[reminders/rules] Failed to parse rules from KV:', err);
  }

  return DEFAULT_RULES;
}

async function saveRulesToKV(rules: ReminderRule[]): Promise<void> {
  await kvWrite.setRaw(RULES_KEY, JSON.stringify(rules));
}

// GET - отримати всі правила
export async function GET(req: NextRequest) {
  try {
    const rules = await getRulesFromKV();
    return NextResponse.json({
      ok: true,
      rules,
    });
  } catch (error) {
    console.error('[reminders/rules] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

// POST - оновити правила
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rules } = body;

    if (!Array.isArray(rules)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'rules must be an array',
        },
        { status: 400 },
      );
    }

    // Валідація правил
    for (const rule of rules) {
      if (!rule.id || !rule.template || typeof rule.daysBefore !== 'number') {
        return NextResponse.json(
          {
            ok: false,
            error: `Invalid rule: ${JSON.stringify(rule)}`,
          },
          { status: 400 },
        );
      }
    }

    await saveRulesToKV(rules);

    return NextResponse.json({
      ok: true,
      message: `Updated ${rules.length} reminder rules`,
      rules,
    });
  } catch (error) {
    console.error('[reminders/rules] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

