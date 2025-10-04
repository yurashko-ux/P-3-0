# Manual verification: ManyChat IG webhook → KeyCRM move

## Prerequisites
- `KEYCRM_BASE_URL` and `KEYCRM_API_TOKEN` are configured and point to a test KeyCRM workspace.
- At least one active campaign is stored in KV with:
  - Base pipeline/status populated (this is where the lookup happens).
  - Target stages (`t1`, `t2`, `texp`) pointing to real KeyCRM pipeline/status combinations.
  - Rules configured so that the message text you will send matches one of the routes.
- An Instagram username that already exists as a KeyCRM card within the campaign’s base pipeline/status.

## Steps
1. Trigger the webhook locally (or against the deployed URL) with a payload that mimics ManyChat:

   ```bash
   curl -sS -X POST "${DEPLOY_URL}/api/mc/manychat" \
     -H 'content-type: application/json' \
     -d '{
       "message": { "text": "<TEXT THAT MATCHES A RULE>" },
       "user": { "username": "<ig_handle_without_@>" }
     }' | jq
   ```

2. Inspect the JSON response:
   - `normalized.handle` is the lowercase Instagram handle prefixed with `@`.
   - `matches[0].rule` reflects the rule that triggered (`v1`, `v2`, or `texp`).
   - `actions[0].search.ok` is `true` and includes the resolved `cardId`.
   - `actions[0].move.ok` is `true`, `actions[0].move.attempt` shows which KeyCRM endpoint succeeded.

3. Confirm in KeyCRM that the card moved to the expected pipeline/status (the stage mapped to `t1`, `t2`, or `texp`).

## Expected result
- The webhook returns `ok: true` with a non-empty `actions` array.
- Each action reports detailed search/move diagnostics, making it easy to spot misconfiguration (missing base pipeline, missing target stage, failed move, etc.).
- The KeyCRM card is present in the new pipeline/status that corresponds to the matched rule.

If any step fails, re-check the campaign’s base/target mappings and ensure the KeyCRM credentials allow card moves.
