# Postman Setup Instructions for Altegio API Support Request

## Step 1: Import Collection (Optional)

You can create a new request in Postman or import a collection.

## Step 2: Configure Environment Variables in Postman

1. Click on "Environments" in the left sidebar
2. Create a new environment called "Altegio API"
3. Add the following variables:

```
ALTEGIO_API_URL = https://api.alteg.io/api/v1
ALTEGIO_USER_TOKEN = [YOUR_USER_TOKEN_HERE]
ALTEGIO_PARTNER_TOKEN = 48kfgfmy8s7u84ruhtju
ALTEGIO_PARTNER_ID = 784
ALTEGIO_APPLICATION_ID = 1195
ALTEGIO_COMPANY_ID = 1169323
```

## Step 3: Test Company Endpoint (Should Work)

### Request 1: Get Companies

**Method**: `GET`
**URL**: `{{ALTEGIO_API_URL}}/companies`
**Headers**:
```
Accept: application/vnd.api.v2+json
Content-Type: application/json
Authorization: Bearer {{ALTEGIO_PARTNER_TOKEN}}, User {{ALTEGIO_USER_TOKEN}}
```

**Expected Response**: Should return company information (200 OK)

---

## Step 4: Test Clients Endpoint (Failing with 403)

### Request 2: Get Clients - Method 1 (POST with company_id in body)

**Method**: `POST`
**URL**: `{{ALTEGIO_API_URL}}/clients`
**Headers**:
```
Accept: application/vnd.api.v2+json
Content-Type: application/json
Authorization: Bearer {{ALTEGIO_PARTNER_TOKEN}}, User {{ALTEGIO_USER_TOKEN}}
X-Partner-ID: {{ALTEGIO_PARTNER_ID}}
X-Application-ID: {{ALTEGIO_APPLICATION_ID}}
```

**Body** (raw JSON):
```json
{
  "company_id": 1169323
}
```

**Expected Error**: `403 Forbidden: No company management rights`

---

### Request 3: Get Clients - Method 2 (POST to company endpoint)

**Method**: `POST`
**URL**: `{{ALTEGIO_API_URL}}/company/{{ALTEGIO_COMPANY_ID}}/clients`
**Headers**:
```
Accept: application/vnd.api.v2+json
Content-Type: application/json
Authorization: Bearer {{ALTEGIO_PARTNER_TOKEN}}, User {{ALTEGIO_USER_TOKEN}}
X-Partner-ID: {{ALTEGIO_PARTNER_ID}}
X-Application-ID: {{ALTEGIO_APPLICATION_ID}}
```

**Body** (raw JSON):
```json
{}
```

**Expected Error**: `403 Forbidden: No company management rights`

---

### Request 4: Get Clients - Method 3 (GET with query param)

**Method**: `GET`
**URL**: `{{ALTEGIO_API_URL}}/clients?company_id={{ALTEGIO_COMPANY_ID}}&partner_id={{ALTEGIO_PARTNER_ID}}`
**Headers**:
```
Accept: application/vnd.api.v2+json
Content-Type: application/json
Authorization: Bearer {{ALTEGIO_PARTNER_TOKEN}}, User {{ALTEGIO_USER_TOKEN}}
X-Partner-ID: {{ALTEGIO_PARTNER_ID}}
X-Application-ID: {{ALTEGIO_APPLICATION_ID}}
```

**Expected Error**: `404 Not Found` or `403 Forbidden`

---

## Step 5: Test Appointments Endpoint (Failing with 403)

### Request 5: Get Appointments

**Method**: `GET`
**URL**: `{{ALTEGIO_API_URL}}/company/{{ALTEGIO_COMPANY_ID}}/appointments?date_from=2025-11-23&date_to=2026-02-23`
**Headers**:
```
Accept: application/vnd.api.v2+json
Content-Type: application/json
Authorization: Bearer {{ALTEGIO_PARTNER_TOKEN}}, User {{ALTEGIO_USER_TOKEN}}
X-Partner-ID: {{ALTEGIO_PARTNER_ID}}
X-Application-ID: {{ALTEGIO_APPLICATION_ID}}
```

**Expected Error**: `403 Forbidden: No company management rights`

---

## Step 6: Screenshot Requirements

For each failing request (especially Request 2, 3, and 5), please take a screenshot showing:

1. **Request Tab**:
   - Full Request URL
   - HTTP Method (GET/POST)
   - Headers section (all headers visible)
   - Body section (if applicable)

2. **Response Tab**:
   - Status code (e.g., 403 Forbidden)
   - Response body (JSON error message)
   - Response headers (if relevant)

## Step 7: Export Tokens Separately

Create a separate file `tokens.json` (DO NOT commit to git) with:

```json
{
  "partner_token": "48kfgfmy8s7u84ruhtju",
  "user_token": "[YOUR_USER_TOKEN_HERE]",
  "partner_id": "784",
  "application_id": "1195",
  "company_id": "1169323"
}
```

**Important**: Replace `[YOUR_USER_TOKEN_HERE]` with your actual User Token from Vercel environment variables, and send this file separately via secure channel.

---

## Example Postman Request Structure

```
POST https://api.alteg.io/api/v1/clients
┌─────────────────────────────────────────┐
│ Headers                                  │
├─────────────────────────────────────────┤
│ Accept: application/vnd.api.v2+json     │
│ Content-Type: application/json          │
│ Authorization: Bearer 48kfg..., User ...│
│ X-Partner-ID: 784                       │
│ X-Application-ID: 1195                  │
└─────────────────────────────────────────┘

Body (raw JSON):
{
  "company_id": 1169323
}

Response:
{
  "success": false,
  "data": null,
  "meta": {
    "message": "No company management rights"
  }
}
Status: 403 Forbidden
```

---

## Notes

- Use the exact headers as shown above
- Make sure `Accept: application/vnd.api.v2+json` is included
- The Authorization header format is: `Bearer <PARTNER_TOKEN>, User <USER_TOKEN>`
- All token values should be sent separately, not in screenshots

