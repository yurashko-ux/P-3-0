# Email to Altegio Support

**Subject**: API 403 Forbidden Error - No Company Management Rights (Non-Public Application)

---

Hello Altegio Support Team,

We are experiencing a `403 Forbidden: No company management rights` error when trying to retrieve clients and appointments via the Altegio API for our non-public application.

## Application Details

- **Application ID**: 1195
- **Partner ID**: 784
- **Partner Token**: 48kfgfmy8s7u84ruhtju
- **Company/Branch ID**: 1169323
- **Application Type**: Non-public application (not listed on marketplace)

## Current Status

✅ **Working**: 
- Authorization is successful
- Getting company information works (`GET /companies`)

❌ **Not Working**:
- Getting clients list returns `403 Forbidden`
- Getting appointments list returns `403 Forbidden`

## Issue Description

Despite having all permissions enabled in the Altegio interface for our User Token, we receive `403 Forbidden: No company management rights` when attempting to:
1. Retrieve clients: `POST /api/v1/clients` with `{"company_id": 1169323}` in body
2. Retrieve clients: `POST /api/v1/company/1169323/clients`
3. Retrieve appointments: `GET /api/v1/company/1169323/appointments`

We have tried multiple endpoints and HTTP methods (GET, POST) as documented in the Altegio API documentation, but all return the same 403 error.

## Permissions Status

We have verified that the following permissions are enabled in the Altegio interface:
- ✅ Read clients
- ✅ Read appointments  
- ✅ Company management

The User Token was regenerated after permissions were configured, but the issue persists.

## Request for Assistance

As requested, we are providing:

1. **Screenshots from Postman** (attached) showing:
   - Request URL
   - HTTP Method
   - Headers
   - Response

2. **Tokens and credentials** (in separate secure file):
   - Partner Token
   - User Token
   - Partner ID
   - Application ID
   - Company ID

## Questions

1. Why does the API return `403 Forbidden: No company management rights` when all permissions appear to be enabled?
2. Are there additional settings required for non-public applications to access clients/appointments endpoints?
3. What is the correct endpoint and method for retrieving company clients?
4. Should we use a different authorization format for non-public applications?
5. Are there any API access levels or scopes that need to be specifically configured?

## Attached Files

- `screenshots/` - Postman screenshots for failing requests
- `tokens.json` - Secure file with authentication tokens (sent separately)
- `POSTMAN_SETUP.md` - Detailed Postman setup instructions we followed

Thank you for your assistance. We look forward to resolving this issue.

Best regards,
[Your Name]
[Your Company]
[Contact Email]

---

**Date**: November 23, 2025  
**Application ID**: 1195  
**Issue**: 403 Forbidden - No Company Management Rights

