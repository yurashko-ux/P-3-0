#!/usr/bin/env tsx
import process from "node:process";
import { kvRead } from "@/lib/kv";
import {
  collectRuleCandidates,
  normalizeCandidate,
  pickRuleCandidate,
  resolveRule,
  type CampaignLike,
} from "@/lib/campaign-rules";

const USAGE = `Usage: npm run find:campaign -- --value <needle> [--slot v1|v2] [--match equals|contains] [--active]

Examples:
  npm run find:campaign -- --value 1 --slot v1 --match equals
  npm run find:campaign -- --value promo --match contains
`;

type MatchMode = "contains" | "equals";

type Options = {
  value: string;
  slots: ("v1" | "v2")[];
  match: MatchMode;
  activeOnly: boolean;
};

function parseArgs(argv: string[]): Options | null {
  const slots: ("v1" | "v2")[] = [];
  let value = "";
  let match: MatchMode = "contains";
  let activeOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--value" || arg === "-v") {
      value = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--slot" || arg === "-s") {
      const raw = (argv[i + 1] ?? "").toLowerCase();
      if (raw === "v1" || raw === "v2") {
        slots.push(raw);
      }
      i += 1;
      continue;
    }
    if (arg === "--match" || arg === "-m") {
      const raw = (argv[i + 1] ?? "").toLowerCase();
      if (raw === "equals" || raw === "equal" || raw === "eq") {
        match = "equals";
      } else if (raw === "contains" || raw === "contain" || raw === "includes") {
        match = "contains";
      }
      i += 1;
      continue;
    }
    if (arg === "--active" || arg === "-a") {
      activeOnly = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return null;
    }
  }

  const needle = normalizeCandidate(value).trim();
  if (!needle) {
    return null;
  }

  const normalizedSlots = slots.length ? Array.from(new Set(slots)) : ["v1", "v2"];

  return {
    value: needle,
    slots: normalizedSlots,
    match,
    activeOnly,
  };
}

type SlotMatch = {
  slot: "v1" | "v2";
  value: string;
};

type CampaignMatch = {
  id: string;
  name: string;
  matches: SlotMatch[];
  rawValues: Record<string, string[]>;
};

function collectRuleStrings(raw: CampaignLike, slot: "v1" | "v2"): string[] {
  const values = new Set<string>();

  const resolved = resolveRule(pickRuleCandidate(raw, slot));
  if (resolved?.value) {
    const normalized = normalizeCandidate(resolved.value).trim();
    if (normalized) values.add(normalized);
  }

  const direct = normalizeCandidate((raw as any)[slot]).trim();
  if (direct) values.add(direct);

  const rules = (raw as any)?.rules;
  if (rules && typeof rules === "object") {
    const slotRule = (rules as Record<string, unknown>)[slot];
    const viaRules = normalizeCandidate(slotRule).trim();
    if (viaRules) values.add(viaRules);

    const fromCandidates = collectRuleCandidates(slotRule ?? null, [], {
      limit: 6,
      maxDepth: 4,
    });

    for (const candidate of fromCandidates.values) {
      const normalized = normalizeCandidate(candidate).trim();
      if (normalized) values.add(normalized);
    }
  }

  return Array.from(values);
}

async function findCampaigns(options: Options): Promise<CampaignMatch[]> {
  const campaigns = await kvRead.listCampaigns<Record<string, any>>();
  if (!campaigns.length) return [];

  const needleLow = options.value.toLowerCase();
  const matches: CampaignMatch[] = [];

  for (const raw of campaigns) {
    if (options.activeOnly && raw?.active === false) continue;

    const id = String(raw?.id ?? raw?.__index_id ?? "").trim();
    if (!id) continue;

    const name = String(raw?.name ?? raw?.title ?? `#${id}`).trim();
    const slotMatches: SlotMatch[] = [];
    const rawValues: Record<string, string[]> = {};

    for (const slot of options.slots) {
      const values = collectRuleStrings(raw, slot);
      if (!values.length) continue;

      rawValues[slot] = values;

      for (const value of values) {
        const valueLow = value.toLowerCase();
        const matched =
          options.match === "equals"
            ? valueLow === needleLow
            : valueLow.includes(needleLow);
        if (matched) {
          slotMatches.push({ slot, value });
          break;
        }
      }
    }

    if (!slotMatches.length) continue;

    matches.push({ id, name, matches: slotMatches, rawValues });
  }

  return matches;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    process.stderr.write(USAGE);
    process.exit(1);
  }

  try {
    const matches = await findCampaigns(options);
    if (!matches.length) {
      process.stdout.write(
        JSON.stringify(
          {
            value: options.value,
            slots: options.slots,
            match: options.match,
            total: 0,
            results: [],
          },
          null,
          2,
        ) + "\n",
      );
      process.exit(0);
    }

    process.stdout.write(
      JSON.stringify(
        {
          value: options.value,
          slots: options.slots,
          match: options.match,
          total: matches.length,
          results: matches,
        },
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    const message = (error as Error | undefined)?.message ?? String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(2);
  }
}

main();
