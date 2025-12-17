# Altegio Support Request - Quick Guide

## 📋 Files Created

1. **`ALTEGIO_SUPPORT_REQUEST_EN.md`** - Full technical details in English
2. **`ALTEGIO_POSTMAN_SETUP.md`** - Step-by-step Postman setup instructions
3. **`ALTEGIO_POSTMAN_COLLECTION.json`** - Ready-to-import Postman collection
4. **`ALTEGIO_SUPPORT_EMAIL_EN.md`** - Ready-to-send email template
5. **`tokens.json.example`** - Template for tokens (copy to `tokens.json` and fill in)

## 🚀 Quick Steps

### Step 1: Prepare Tokens File

1. Copy `tokens.json.example` to `tokens.json`
2. Open `tokens.json` and replace `[YOUR_USER_TOKEN_FROM_VERCEL_ENV_VARS]` with your actual User Token from Vercel environment variables
3. **DO NOT commit `tokens.json` to git!**

### Step 2: Set Up Postman

**Option A: Import Collection (Easiest)**
1. Open Postman
2. Click "Import" → Select `ALTEGIO_POSTMAN_COLLECTION.json`
3. Go to collection → Variables tab → Update `ALTEGIO_USER_TOKEN` with your actual token
4. Run all requests in order

**Option B: Manual Setup**
Follow the detailed instructions in `ALTEGIO_POSTMAN_SETUP.md`:

1. Create environment variables in Postman
2. Test the working endpoint (GET /companies) - should work ✅
3. Test failing endpoints:
   - POST /clients (should fail with 403)
   - POST /company/1169323/clients (should fail with 403)
   - GET /company/1169323/appointments (should fail with 403)

### Step 3: Take Screenshots

For each failing request, take a screenshot showing:
- **Request tab**: URL, Method, Headers, Body
- **Response tab**: Status code, Response body, Response headers

Save screenshots in a `screenshots/` folder (or attach directly to email).

### Step 4: Send Email

1. Open `ALTEGIO_SUPPORT_EMAIL_EN.md`
2. Copy the email content
3. Attach:
   - Screenshots from Postman
   - `tokens.json` file (send separately via secure channel)
4. Send to Altegio support

## 📧 Email Template

The email template in `ALTEGIO_SUPPORT_EMAIL_EN.md` includes:
- Clear problem description
- Application details
- List of attempted endpoints
- Questions for support team

## 🔐 Security Note

**Never commit `tokens.json` to git!**

The file contains sensitive credentials. Use `tokens.json.example` as a template and keep the actual `tokens.json` file local only, or send it directly to support via secure channel.

## 📝 Current Issue Summary

- ✅ Authorization works (can get company info)
- ❌ Getting clients: 403 Forbidden
- ❌ Getting appointments: 403 Forbidden

All permissions appear to be enabled in Altegio interface, but API still returns 403 errors.

