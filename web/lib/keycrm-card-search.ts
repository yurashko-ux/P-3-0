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

  // Спочатку перевіряємо точний збіг за social_id (найточніший критерій)
  // Якщо знайдено збіг за social_id - одразу повертаємо результат
  for (const candidate of candidates) {
    if (!candidate.path.includes('social_id')) {
      continue; // Пропускаємо поля, які не є social_id
    }
    
    const raw = candidate.value ?? "";
    const candidateSocial = normSocial(raw);
    
    // Перевіряємо точний збіг за social_id
    if (needleSocial && candidateSocial && candidateSocial === needleSocial) {
      return { field: candidate.path, value: raw };
    }
  }

  // Якщо не знайдено збігу за social_id, перевіряємо інші поля (full_name тощо)
  // Але тільки якщо needle не виглядає як social_id
  // (якщо needle виглядає як social_id, але не знайдено збігу - повертаємо null)
  if (needleSocial) {
    // Якщо needle виглядає як social_id, але не знайдено збігу за social_id - повертаємо null
    return null;
  }

  // Перевіряємо збіг за іншими полями (full_name тощо)
  for (const candidate of candidates) {
    const raw = candidate.value ?? "";
    const candidateNorm = norm(raw);

    if (needleNorm && candidateNorm && candidateNorm === needleNorm) {
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
          // Знайдено точний збіг - одразу повертаємо цю картку
          // Перевіряємо, що збіг саме за social_id (найточніший критерій)
          const isSocialIdMatch = hit.field.includes('social_id');
          
          // Якщо це збіг за social_id - одразу повертаємо результат
          // Якщо це збіг за іншим полем - також повертаємо, але перевіряємо точність
          return {
            ok: true,
            needle,
            pagesScanned,
            cardsChecked,
            match: {
              cardId: Number(card.id),
              title: card?.title ?? null,
              matchedField: hit.field,
              matchedValue: hit.value,
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

        const hasClientCandidates = candidates.some((candidate) => candidate.path.startsWith("client"));
        const shouldFetchDetails =
          card?.id != null &&
          (candidates.length === 0 || (!hasClientCandidates && !Array.isArray(card?.client?.profiles)));

        if (!listingOnly && shouldFetchDetails && card?.id != null) {
          const details = await fetchCardDetails(card.id);
          const detailedCandidates = collectCandidates(details);
          const detailedHit = matchCandidates(needle, detailedCandidates);

          if (detailedHit) {
            // Знайдено точний збіг в деталях - одразу повертаємо цю картку
            return {
              ok: true,
              needle,
              pagesScanned,
              cardsChecked,
              match: {
                cardId: Number(details?.id ?? card?.id),
                title: details?.title ?? card?.title ?? null,
                matchedField: detailedHit.field,
                matchedValue: detailedHit.value,
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

  // Якщо не знайдено точного збігу - повертаємо null match
  // Не вибираємо першу картку зі списку - тільки точний збіг

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
