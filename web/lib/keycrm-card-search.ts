// web/lib/keycrm-card-search.ts
import { assertKeycrmEnv, keycrmHeaders, keycrmUrl } from "@/lib/env";

export type KeycrmCardSearchOptions = {
  /** Значення, яке шукаємо у contact/client/profiles */
  needle?: string;
  /** Фільтр за pipeline_id (опц.) */
  pipelineId?: number;
  /** Фільтр за status_id (опц.) */
  statusId?: number;
  /** Скільки карток тягнути за один запит (1..100, дефолт 50) */
  perPage?: number;
  /** Максимальна кількість сторінок (1..100, дефолт 20) */
  maxPages?: number;
};

export type KeycrmCardSearchMatch = {
  cardId: number;
  title: string | null;
  matchedField: string;
  matchedValue: string | null;
};

export type KeycrmCardSearchItem = {
  cardId: number;
  title: string | null;
  pipelineId: number | null;
  pipelineTitle: string | null;
  statusId: number | null;
  statusTitle: string | null;
  contactName: string | null;
  contactSocialId: string | null;
  clientName: string | null;
  clientSocialId: string | null;
};

export type KeycrmCardSearchResult = {
  ok: true;
  needle: string;
  pagesScanned: number;
  cardsChecked: number;
  match: KeycrmCardSearchMatch | null;
  items: KeycrmCardSearchItem[];
  filters: {
    pipelineId: number | null;
    statusId: number | null;
    perPage: number;
    maxPages: number;
  };
};

export type KeycrmCardSearchError = {
  ok: false;
  error: string;
  details?: unknown;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const norm = (value?: string | null) => (value ?? "").trim().toLowerCase();
const normSocial = (value?: string | null) => {
  let normalized = norm(value);
  if (!normalized) return "";

  // Drop leading @ characters that користувачі часто додають у хендлах.
  normalized = normalized.replace(/^@+/, "");

  if (!normalized) return "";

  // Приберемо протокол, www. та хеш/параметри, якщо social_id збережений як повний URL.
  normalized = normalized.replace(/^https?:\/\//, "");
  normalized = normalized.replace(/^www\./, "");

  const hashIndex = normalized.indexOf("#");
  if (hashIndex !== -1) {
    normalized = normalized.slice(0, hashIndex);
  }

  const queryIndex = normalized.indexOf("?");
  if (queryIndex !== -1) {
    normalized = normalized.slice(0, queryIndex);
  }

  normalized = normalized.replace(/\/+$/, "");

  if (!normalized) return "";

  const segments = normalized.split("/").filter(Boolean);

  if (segments.length >= 2) {
    return segments[segments.length - 1];
  }

  return segments[0] ?? normalized;
};

const normalizeId = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }

  return null;
};

class KeycrmHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;
  readonly retryAfter: string | null;

  constructor(status: number, statusText: string, body: string, retryAfter: string | null) {
    const prefix = `KeyCRM ${status} ${statusText}`.trim();
    super(body ? `${prefix}: ${body}` : prefix);
    this.name = "KeycrmHttpError";
    this.status = status;
    this.responseBody = body;
    this.retryAfter = retryAfter;
  }
}

type Candidate = { path: string; value: string | null };

function collectCandidates(card: any): Candidate[] {
  const candidates: Candidate[] = [];

  const contact = card?.contact ?? null;
  const clients: any[] = [];

  if (card?.client) clients.push(card.client);
  if (contact?.client) clients.push(contact.client);

  if (contact) {
    if (contact.full_name != null) {
      candidates.push({ path: "contact.full_name", value: String(contact.full_name) });
    }
    if (contact.social_id != null) {
      candidates.push({ path: "contact.social_id", value: String(contact.social_id) });
    }
  }

  for (const [index, client] of clients.entries()) {
    if (!client) continue;
    if (client.full_name != null) {
      const suffix = clients.length > 1 ? `#${index}` : "";
      candidates.push({ path: `client${suffix}.full_name`, value: String(client.full_name) });
    }
    if (client.social_id != null) {
      const suffix = clients.length > 1 ? `#${index}` : "";
      candidates.push({ path: `client${suffix}.social_id`, value: String(client.social_id) });
    }
    if (Array.isArray(client.profiles)) {
      const suffix = clients.length > 1 ? `#${index}` : "";
      for (const profile of client.profiles) {
        if (profile?.value != null) {
          const idLabel = profile?.id != null ? profile.id : "?";
          candidates.push({ path: `client${suffix}.profiles[${idLabel}].value`, value: String(profile.value) });
        }
      }
    }
  }

  return candidates;
}

function matchCandidates(needle: string, candidates: Candidate[]) {
  const needleNorm = norm(needle);
  const needleSocial = normSocial(needle);

  if (!needleNorm && !needleSocial) {
    return null;
  }

  for (const candidate of candidates) {
    const raw = candidate.value ?? "";
    const candidateNorm = norm(raw);
    const candidateSocial = normSocial(raw);

    if (needleNorm && candidateNorm && candidateNorm === needleNorm) {
      return { field: candidate.path, value: raw };
    }
    if (needleSocial && candidateSocial && candidateSocial === needleSocial) {
      return { field: candidate.path, value: raw };
    }
  }

  return null;
}

async function fetchCardsPage(
  page: number,
  perPage: number,
  pipelineId: number | null,
  statusId: number | null
) {
  const baseQuery = () => {
    const qs = new URLSearchParams();
    qs.set("page[number]", String(page));
    qs.set("page[size]", String(perPage));

    if (statusId != null) {
      qs.set("filter[status_id]", String(statusId));
    }

    const relations = ["contact", "contact.client", "status"];
    for (const relation of relations) {
      qs.append("include[]", relation);
      qs.append("with[]", relation);
    }

    return qs;
  };

  const attempts: { path: string; configure?: (qs: URLSearchParams) => void }[] = [];

  if (pipelineId != null) {
    attempts.push({ path: `/pipelines/${encodeURIComponent(String(pipelineId))}/cards` });
  }

  attempts.push({
    path: "/pipelines/cards",
    configure: (qs) => {
      if (pipelineId != null) {
        qs.set("filter[pipeline_id]", String(pipelineId));
      }
    },
  });

  let lastError: KeycrmHttpError | null = null;

  for (const attempt of attempts) {
    const qs = baseQuery();
    if (attempt.configure) {
      attempt.configure(qs);
    }

    const res = await fetch(keycrmUrl(`${attempt.path}?${qs.toString()}`), {
      headers: keycrmHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new KeycrmHttpError(res.status, res.statusText, body, res.headers.get("retry-after"));

      if (pipelineId != null && attempt.path !== "/pipelines/cards" && res.status === 404) {
        lastError = err;
        continue;
      }

      throw err;
    }

    const json = await res.json();
    const data = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : [];

    const hasNext = (() => {
      if (json?.links?.next) return true;
      if (json?.next_page_url) return true;
      const current = Number(json?.meta?.current_page ?? json?.current_page ?? page);
      const last = Number(json?.meta?.last_page ?? json?.last_page ?? current);
      if (Number.isFinite(current) && Number.isFinite(last)) {
        return current < last;
      }
      return data.length === perPage;
    })();

    return { data, hasNext };
  }

  throw lastError ?? new KeycrmHttpError(404, "Not Found", "", null);
}

async function fetchCardDetails(id: number | string) {
  const res = await fetch(keycrmUrl(`/pipelines/cards/${id}`), {
    headers: keycrmHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new KeycrmHttpError(res.status, res.statusText, body, res.headers.get("retry-after"));
  }

  return await res.json();
}

export async function searchKeycrmCardByIdentity(
  options: KeycrmCardSearchOptions
): Promise<KeycrmCardSearchResult | KeycrmCardSearchError> {
  const rawNeedle = options.needle ?? "";
  const needle = rawNeedle.trim();
  const listingOnly = needle.length === 0;

  try {
    assertKeycrmEnv();
  } catch (err) {
    return { ok: false, error: "keycrm_env_missing", details: err instanceof Error ? err.message : err };
  }

  const perPage = clamp(options.perPage ?? 50, 1, 100);
  const maxPages = clamp(options.maxPages ?? 20, 1, 100);
  const pipelineId = normalizeId(options.pipelineId);
  const statusId = normalizeId(options.statusId);

  let pagesScanned = 0;
  let cardsChecked = 0;
  const items: KeycrmCardSearchItem[] = [];

  try {
    for (let page = 1; page <= maxPages; page++) {
      const { data, hasNext } = await fetchCardsPage(page, perPage, pipelineId, statusId);
      pagesScanned = page;

      for (const card of data) {
        const cardPipelineId = normalizeId(card?.pipeline_id ?? card?.pipeline?.id);
        const cardStatusId = normalizeId(card?.status_id ?? card?.status?.id);

        const pipelineMatches =
          pipelineId == null || cardPipelineId === pipelineId || cardPipelineId == null;
        const statusMatches = statusId == null || cardStatusId === statusId || cardStatusId == null;

        if (!pipelineMatches || !statusMatches) {
          continue;
        }

        const summary: KeycrmCardSearchItem = {
          cardId: Number(card?.id ?? NaN),
          title: card?.title ?? null,
          pipelineId: cardPipelineId,
          pipelineTitle: (card?.pipeline?.title ?? card?.pipeline_title ?? null) ?? null,
          statusId: cardStatusId,
          statusTitle: (card?.status?.title ?? card?.status_title ?? null) ?? null,
          contactName: card?.contact?.full_name ?? null,
          contactSocialId: card?.contact?.social_id ?? null,
          clientName:
            card?.client?.full_name ??
            card?.contact?.client?.full_name ??
            (Array.isArray(card?.clients) && card.clients[0]?.full_name) ??
            null,
          clientSocialId:
            card?.client?.social_id ??
            card?.contact?.client?.social_id ??
            (Array.isArray(card?.clients) && card.clients[0]?.social_id) ??
            null,
        };

        if (Number.isFinite(summary.cardId)) {
          items.push(summary);
        }

        const candidates = collectCandidates(card);
        cardsChecked++;

        if (listingOnly) {
          continue;
        }

        const hit = matchCandidates(needle, candidates);

        if (hit) {
          // Знайдено збіг - продовжуємо пошук, щоб знайти всі картки, які відповідають критеріям
          // і вибрати найточнішу (найновішу або з найбільшою кількістю збігів)
          // Але якщо це перший збіг, зберігаємо його як потенційний результат
          if (!items.some((item) => item.cardId === Number(card.id))) {
            // Додаємо картку до items, якщо її там ще немає
            items.push(summary);
          }
          
          // Продовжуємо пошук, щоб знайти всі картки, які відповідають критеріям
          // і вибрати найточнішу (найновішу)
          continue;
        }

        const hasClientCandidates = candidates.some((candidate) => candidate.path.startsWith("client"));
        const shouldFetchDetails =
          card?.id != null &&
          (candidates.length === 0 || (!hasClientCandidates && !Array.isArray(card?.client?.profiles)));

        if (!listingOnly && shouldFetchDetails && card?.id != null) {
          const details = await fetchCardDetails(card.id);
          const detailedCandidates = collectCandidates(details);
          const detailedHit = matchCandidates(needle, detailedCandidates);

          if (detailedHit) {
            // Знайдено збіг в деталях - продовжуємо пошук, щоб знайти всі картки
            if (!items.some((item) => item.cardId === Number(details?.id ?? card?.id))) {
              const detailedSummary: KeycrmCardSearchItem = {
                cardId: Number(details?.id ?? card?.id),
                title: details?.title ?? card?.title ?? null,
                pipelineId: cardPipelineId,
                pipelineTitle: (details?.pipeline?.title ?? card?.pipeline?.title ?? card?.pipeline_title ?? null) ?? null,
                statusId: cardStatusId,
                statusTitle: (details?.status?.title ?? card?.status?.title ?? card?.status_title ?? null) ?? null,
                contactName: details?.contact?.full_name ?? card?.contact?.full_name ?? null,
                contactSocialId: details?.contact?.social_id ?? card?.contact?.social_id ?? null,
                clientName:
                  details?.client?.full_name ??
                  card?.client?.full_name ??
                  details?.contact?.client?.full_name ??
                  card?.contact?.client?.full_name ??
                  null,
                clientSocialId:
                  details?.client?.social_id ??
                  card?.client?.social_id ??
                  details?.contact?.client?.social_id ??
                  card?.contact?.client?.social_id ??
                  null,
              };
              items.push(detailedSummary);
            }
            // Продовжуємо пошук, щоб знайти всі картки
            continue;
          }
        }
      }

      if (!hasNext) {
        break;
      }
    }
  } catch (err) {
    if (err instanceof KeycrmHttpError) {
      if (err.status === 429) {
        let parsed: unknown = err.responseBody;
        try {
          parsed = err.responseBody ? JSON.parse(err.responseBody) : err.responseBody;
        } catch {
          parsed = err.responseBody;
        }
        return {
          ok: false,
          error: "keycrm_rate_limited",
          details: {
            status: err.status,
            message: err.message,
            retryAfter: err.retryAfter,
            response: parsed,
          },
        };
      }

      return {
        ok: false,
        error: "keycrm_request_failed",
        details: {
          status: err.status,
          message: err.message,
          response: (() => {
            try {
              return err.responseBody ? JSON.parse(err.responseBody) : err.responseBody;
            } catch {
              return err.responseBody;
            }
          })(),
        },
      };
    }

    return { ok: false, error: "keycrm_request_failed", details: err instanceof Error ? err.message : err };
  }

  // Якщо знайдено картки, які відповідають критеріям, вибираємо найновішу (найбільший cardId)
  // або першу, якщо немає інформації про дату створення
  if (items.length > 0 && !listingOnly) {
    // Сортуємо за cardId (найбільший = найновіший, якщо ID інкрементні)
    const sortedItems = [...items].sort((a, b) => b.cardId - a.cardId);
    const bestMatch = sortedItems[0];
    
    // Знаходимо оригінальну картку для отримання matchedField та matchedValue
    // Для цього потрібно перевірити, яка картка має найточніший збіг
    // Але оскільки ми вже знаємо, що всі картки в sortedItems відповідають критеріям,
    // використовуємо першу (найновішу)
    return {
      ok: true,
      needle,
      pagesScanned,
      cardsChecked,
      match: {
        cardId: bestMatch.cardId,
        title: bestMatch.title,
        matchedField: "auto.best_match",
        matchedValue: bestMatch.contactSocialId ?? bestMatch.clientSocialId ?? bestMatch.contactName ?? bestMatch.clientName ?? null,
      },
      items,
      filters: {
        pipelineId,
        statusId,
        perPage,
        maxPages,
      },
    };
  }

  return {
    ok: true,
    needle,
    pagesScanned,
    cardsChecked,
    match: null,
    items,
    filters: {
      pipelineId,
      statusId,
      perPage,
      maxPages,
    },
  };
}
