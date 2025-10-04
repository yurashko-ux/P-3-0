# Manual test: ManyChat webhook routes IG matches to KeyCRM

## Prerequisites
- Valid `KEYCRM_API_URL` and `KEYCRM_API_TOKEN` env vars configured for the app (or use the staging KeyCRM workspace).
- Campaign in KV with populated fields:
  - `base_pipeline_id` / `base_status_id` (or the `base` object) referencing the stage where new IG leads appear.
  - Rule `rules.v1` or `rules.v2` matching the trigger phrase you will send.
  - Corresponding target (`t1`/`t2`) filled via the admin UI or API (pipeline + status IDs).
- A KeyCRM card located in the base pipeline/status whose contact has the IG username you will test (with or without the `@` prefix).

## Steps
1. Compose a ManyChat webhook payload, e.g.:
   ```json
   {
     "message": { "text": "ціна" },
     "subscriber": { "username": "test_ig_handle" }
   }
   ```
   Ensure that `message.text` equals (or contains) the rule value in your campaign and `subscriber.username` matches the IG handle of the KeyCRM card from the prerequisites.
2. Send the payload to `POST /api/mc/manychat` (e.g. via `curl` or Postman). Include the `x-mc-token` header if your project enforces it.
3. Observe the JSON response:
   - `matches` must list the campaign with `applied` equal to `"v1"` or `"v2"` depending on the matched rule and include the resolved base pair.
   - `routing[0].find.ok` should be `true` and contain the located `cardId`.
   - `routing[0].move.ok` should be `true` with `attempt` showing which KeyCRM endpoint succeeded (`cards/{id}/move` or `pipelines/cards/move`). If the card was already in the target, the entry reports `skipped: "already_in_target"`.
4. In KeyCRM, verify that the card moved from the base status to the campaign’s target status.
5. (Optional) Trigger the webhook again with a non-matching phrase and confirm that `routing` is empty.

## Expected result
- The response clearly surfaces the match and routing details.
- The card is moved (or reported as already moved) to the configured campaign target in KeyCRM.
