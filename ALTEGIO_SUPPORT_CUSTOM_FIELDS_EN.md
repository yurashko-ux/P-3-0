# Request to Altegio Support: Retrieving Custom Fields and Additional Client Data via API

## Issue Description

When using the Altegio API to retrieve client information, the API only returns basic fields:
- `id`
- `name`
- `phone`
- `email`
- `last_visit_date`

**Missing fields that we need:**
- `custom_fields` (including custom fields such as "Instagram user name")
- `card_number` (loyalty card number)
- `note` (client notes/comments)

These fields are visible and filled in the Altegio web interface for clients, but are not returned by the API.

## Attempted API Requests

### 1. POST /company/{company_id}/clients/search

**Request:**
```json
{
  "page": 1,
  "page_size": 10,
  "fields": ["id", "name", "phone", "email", "custom_fields"],
  "order_by": "last_visit_date",
  "order_by_direction": "desc"
}
```

**Response:** Returns only basic fields, without `custom_fields`

### 2. GET /company/{company_id}/client/{client_id}

**Variants tested:**
- `?include[]=custom_fields&with[]=custom_fields&fields[]=custom_fields`
- `?fields[]=id&fields[]=name&fields[]=phone&fields[]=email&fields[]=custom_fields`
- `?include[]=*&with[]=*&fields[]=*`
- `?fields[]=card_number&fields[]=note`

**Response:** Returns only basic fields, without `custom_fields`, `card_number`, or `note`

### 3. POST /company/{company_id}/clients

**Request body:**
```json
{
  "include": ["custom_fields"],
  "with": ["custom_fields"]
}
```

**Response:** Returns only client IDs

### 4. POST /company/{company_id}/clients/search with specific fields

**Request:**
```json
{
  "page": 1,
  "page_size": 10,
  "fields": ["id", "name", "phone", "email", "card_number", "note", "custom_fields"],
  "order_by": "last_visit_date"
}
```

**Response:** Returns only basic fields, missing `card_number`, `note`, and `custom_fields`

## Expected Response

We need to retrieve the complete client structure, including:
- Basic fields (id, name, phone, email)
- `card_number` - loyalty card number (visible in web interface)
- `note` - client notes/comments (visible in web interface)
- `custom_fields` object containing:
  - `instagram-user-name` (custom field API key)
  - Other custom fields

**Example expected response:**
```json
{
  "id": 160692050,
  "name": "Марків Валерія",
  "phone": "+380955747853",
  "email": "",
  "card_number": "mv_valeria",
  "note": "mv_valeria",
  "custom_fields": {
    "instagram-user-name": "mv_valeria"
  }
}
```

**Actual response received:**
```json
{
  "id": 160692050,
  "name": "Марків Валерія",
  "phone": "+380955747853",
  "email": "",
  "last_visit_date": "2025-11-26 18:00:00"
}
```

## Questions for Support

1. **Is it possible to retrieve `card_number` and `note` fields through the API?**
   - If yes, what is the correct endpoint and parameters?
   - What field names should we use? (e.g., `card_number`, `cardNumber`, `loyalty_card_number`)

2. **Is it possible to retrieve `custom_fields` through the API?**
   - If yes, what is the correct endpoint and parameters?
   - Do we need additional access rights?

3. **Are additional access rights required?**
   - We have granted all rights for "Client Database" (20 out of 20 rights)
   - USER_TOKEN was generated after granting rights
   - Are there specific permissions needed for custom fields or additional client data?

4. **Alternative approaches:**
   - Can we retrieve this data through webhooks?
   - Is there another way to access this data via API?

5. **Field names and structure:**
   - What are the exact field names for card number and notes in the API?
   - Are these fields stored in `custom_fields` or as separate top-level fields?
   - What is the correct API key for custom fields?

## Technical Details

- **Application ID:** 1203
- **Company ID (Location ID):** 1169323
- **Partner ID:** 784
- **API Version:** v1 (with header `Accept: application/vnd.api.v2+json`)
- **Authorization format:** `Bearer <partner_token>, User <user_token>`
- **Custom field API key:** `instagram-user-name`

## Example Request

```bash
curl -X GET "https://api.alteg.io/api/v1/company/1169323/client/160692050?include[]=custom_fields&fields[]=card_number&fields[]=note" \
  -H "Accept: application/vnd.api.v2+json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <partner_token>, User <user_token>"
```

## Additional Information

- Custom fields are configured in the Altegio web interface
- Card number and Note fields are filled and visible in the web interface for clients
- All access rights have been granted
- USER_TOKEN was regenerated after granting rights
- The application is connected to our CRM account

## Use Case

We need this data to:
- Send reminder messages to clients about appointments via Instagram
- Track client loyalty card numbers
- Store and retrieve client notes for internal use

Without access to these fields via API, we cannot fully automate our client communication workflows.

---

**Date:** January 26, 2025
**Application:** Non-public application (Application ID: 1203)
**Contact:** [your email]

Thank you for your assistance!

