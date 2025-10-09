// web/lib/keycrm-card-search.ts
import { assertKeycrmEnv, keycrmHeaders, keycrmUrl } from "@/lib/env";

export type KeycrmCardSearchOptions = {
  /** Значення, яке шукаємо у contact/client/profiles */
  needle: string;
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

export type KeycrmCardSearchResult = {
  ok: true;
  needle: string;
  pagesScanned: number;
  cardsChecked: number;
  match: KeycrmCardSearchMatch | null;
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
const normSocial = (value?: string | null) => norm(value).replace(/^@+/, "");

function collectCandidates(card: any) {
  const candidates: { path: string; value: string | null }[] = [];

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

function matchCard(needle: string, card: any) {
  const needleNorm = norm(needle);
  const needleSocial = normSocial(needle);

  if (!needleNorm && !needleSocial) {
    return null;
  }

  for (const candidate of collectCandidates(card)) {
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
  const qs = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });

  if (pipelineId != null) qs.set("pipeline_id", String(pipelineId));
  if (statusId != null) qs.set("status_id", String(statusId));

  // намагаємось одразу підвантажити потрібні зв'язки; API може проігнорувати
  qs.append("with[]", "contact");
  qs.append("with[]", "contact.client");
  qs.append("with[]", "client");
  qs.append("with[]", "client.profiles");

  const res = await fetch(keycrmUrl(`/pipelines/cards?${qs.toString()}`), {
    headers: keycrmHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KeyCRM ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
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

async function fetchCardDetails(id: number | string) {
  const res = await fetch(keycrmUrl(`/pipelines/cards/${id}`), {
    headers: keycrmHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KeyCRM ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }

  return await res.json();
}

export async function searchKeycrmCardByIdentity(
  options: KeycrmCardSearchOptions
): Promise<KeycrmCardSearchResult | KeycrmCardSearchError> {
  const needle = options.needle?.trim();
  if (!needle) {
    return { ok: false, error: "needle_required" };
  }

  try {
    assertKeycrmEnv();
  } catch (err) {
    return { ok: false, error: "keycrm_env_missing", details: err instanceof Error ? err.message : err };
  }

  const perPage = clamp(options.perPage ?? 50, 1, 100);
  const maxPages = clamp(options.maxPages ?? 20, 1, 100);
  const pipelineId = Number.isFinite(options.pipelineId ?? NaN) ? options.pipelineId ?? null : null;
  const statusId = Number.isFinite(options.statusId ?? NaN) ? options.statusId ?? null : null;

  let pagesScanned = 0;
  let cardsChecked = 0;

  try {
    for (let page = 1; page <= maxPages; page++) {
      const { data, hasNext } = await fetchCardsPage(page, perPage, pipelineId, statusId);
      pagesScanned = page;

      for (const card of data) {
        if (pipelineId != null && card?.pipeline_id !== pipelineId) continue;
        if (statusId != null && card?.status_id !== statusId) continue;

        const hit = matchCard(needle, card);
        cardsChecked++;

        if (hit) {
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
            filters: {
              pipelineId,
              statusId,
              perPage,
              maxPages,
            },
          };
        }

        if (card?.id != null) {
          const details = await fetchCardDetails(card.id);
          const detailedHit = matchCard(needle, details);

          if (detailedHit) {
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
    return { ok: false, error: "keycrm_request_failed", details: err instanceof Error ? err.message : err };
  }

  return {
    ok: true,
    needle,
    pagesScanned,
    cardsChecked,
    match: null,
    filters: {
      pipelineId,
      statusId,
      perPage,
      maxPages,
    },
  };
}
