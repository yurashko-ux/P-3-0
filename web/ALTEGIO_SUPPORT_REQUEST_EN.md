# Altegio API Support Request

## Problem

We are receiving a `403 Forbidden: {"success":false,"data":null,"meta":{"message":"No company management rights"}}` error when trying to retrieve clients or appointments via API for a non-public application.

**Authorization Status**: ✅ Resolved (Partner ID issue)
**Current Issue**: ❌ Missing access rights to clients and appointments

## Context

- **Application Type**: Non-public application (not for marketplace)
- **Application ID**: 1195 (previously 1193)
- **Partner Token**: 48kfgfmy8s7u84ruhtju
- **Partner ID**: 784
- **User Token**: Generated in "API Access" section of the marketplace
- **Salon ID (Branch ID)**: 1169323
- **Company ID**: 1169323

## Environment Variables

```
ALTEGIO_API_URL = https://api.alteg.io/api/v1
ALTEGIO_USER_TOKEN = [YOUR_USER_TOKEN]
ALTEGIO_PARTNER_TOKEN = 48kfgfmy8s7u84ruhtju
ALTEGIO_PARTNER_ID = 784
ALTEGIO_APPLICATION_ID = 1195
ALTEGIO_COMPANY_ID = 1169323
```

## Current Status

**What works:**
- ✅ Getting company information (`GET /companies`)
- ✅ Authorization (Authorization header is accepted)

**What does NOT work:**
- ❌ Getting list of clients (`POST /company/1169323/clients` or `GET /company/1169323/clients`)
- ❌ Getting appointments (`GET /company/1169323/appointments`)

## Attempted Endpoints and Methods

### Clients Endpoint Attempts

1. **GET** `/api/v1/company/1169323/clients`
   - Response: `405 Method Not Allowed`

2. **POST** `/api/v1/company/1169323/clients`
   - Body: `{}`
   - Response: `403 Forbidden: No company management rights`

3. **POST** `/api/v1/clients`
   - Body: `{"company_id": 1169323}`
   - Response: `403 Forbidden: No company management rights`

4. **GET** `/api/v1/clients?company_id=1169323`
   - Response: `404 Not Found`

### Appointments Endpoint Attempts

1. **GET** `/api/v1/company/1169323/appointments`
   - Response: `403 Forbidden: No company management rights`

## Authorization Header Format

Currently using:
```
Authorization: Bearer 48kfgfmy8s7u84ruhtju, User [USER_TOKEN]
Accept: application/vnd.api.v2+json
Content-Type: application/json
```

Additional headers attempted:
- `X-Partner-ID: 784`
- `Partner-ID: 784`
- `X-Application-ID: 1195`
- `Application-ID: 1195`

## Questions for Support

1. Why does the API return `403 Forbidden: No company management rights` even though all permissions are enabled in the Altegio interface for the User Token?

2. Are additional settings required for non-public applications?

3. What specific permissions need to be enabled for access to clients and appointments?

4. Could the issue be that the User Token was created before permissions were enabled, requiring a new token?

5. What is the correct endpoint and HTTP method for retrieving company clients?

6. Are there any special requirements for non-public applications to access clients/appointments endpoints?

## Expected Behavior

With the correct Authorization header format and configured permissions, the API should:
- ✅ Retrieve the list of company clients (`/company/1169323/clients`)
- ✅ Retrieve the list of company appointments (`/company/1169323/appointments`)
- ✅ Retrieve client information with custom fields (including Instagram username)

## Additional Information

- Webhook URL configured in marketplace: `https://[your-domain].vercel.app/api/altegio/webhook`
- User Token obtained from "API Access" section of Altegio marketplace
- **All permissions appear to be enabled for User Token in Altegio interface**
- Application ID: 1195
- Partner ID: 784
- Company/Branch ID: 1169323

---

**Date**: 2025-11-23  
**Application ID**: 1195  
**Partner ID**: 784  
**Company ID**: 1169323

