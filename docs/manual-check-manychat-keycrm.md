# Manual check: ManyChat → KeyCRM routing

Use this checklist to smoke-test the webhook after deploying:

1. Ensure the KV storage contains an active campaign with populated `base_pipeline_id` / `base_status_id` and rule-specific targets.
2. Trigger the ManyChat webhook manually, for example:
   ```bash
   curl -X POST https://<your-host>/api/mc/manychat \
     -H 'Content-Type: application/json' \
     -H 'x-mc-token: <token-if-configured>' \
     -d '{
       "message": { "text": "ціна" },
       "subscriber": {
         "username": "demo_ig_handle",
         "full_name": "Demo User"
       }
     }'
   ```
3. Confirm the JSON response contains a non-null `operations[0].cardId`, the resolved rule (`v1`/`v2`) and `move.ok === true`.
4. In KeyCRM, verify that the existing card for the IG handle moved to the rule-specific pipeline/status.
5. Review the KV log key `logs:mc:<YYYY-MM-DD>` for a record that mirrors the response (card id, rule, move result).

This verifies the full flow from ManyChat payload to KeyCRM card move.
