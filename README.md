# Aegis — Security Awareness Training Platform
**CyberShield Technologies LLC · v2.0**

Live-fire phishing simulation and security awareness training.
GitHub → Vercel auto-deploy. Custom domain on `aegis.cybershield-llc.com`.

---

## Architecture

```
Register → Training (role selector) → General Track (8 modules)
                                           ↓ certificate issued
                                           ↓ phish scheduled (+30 min)
                                   → Technical Track (6 modules, dev roles only)
                                           ↓ certificate issued
                              [30 min later]
                                   → Phish email arrives
                                   → Click? → Fake login → Phished debrief
                                   → No click? → Admin sees it. That's the win.
```

**Storage:** Vercel KV (Upstash Redis) — enrollment records (90 days), certificates (5 years)  
**Email:** Resend.com — platform-matched phishing simulation  
**Cron:** Vercel cron every 15 min — fires scheduled phish emails  
**Auth:** Basic Auth on admin dashboard (ADMIN_USER / ADMIN_PASS env vars)

---

## Setup — 5 Steps

### Step 1 — Resend domain verification
1. resend.com → Domains → Add → `cybershield-llc.com`
2. Add the DNS records Resend shows you in Cloudflare DNS
3. Verify → green

### Step 2 — GitHub repo
```bash
cd ~/Downloads && unzip aegis.zip
cd aegis
git init
git add .
git commit -m "Aegis v2.0"
git branch -M main
git remote add origin https://github.com/christrudeau2021/aegis.git
git push -u origin main
```

### Step 3 — Vercel project + KV
1. vercel.com → Add New Project → Import `christrudeau2021/aegis`
2. Framework: Other — root `/` — Deploy
3. Project → Storage → Create Database → KV → `aegis-kv` → Create
   (Vercel auto-adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`)

### Step 4 — Environment Variables
In Vercel → Settings → Environment Variables:

| Variable | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxxxxxx` | From Resend dashboard |
| `ADMIN_USER` | `admin` (or your choice) | Dashboard username |
| `ADMIN_PASS` | strong password | Dashboard password — store in 1Password |
| `PHISH_DELAY_MINUTES` | `30` | Delay after cert before phish fires (configurable) |
| `AEGIS_BASE_URL` | `https://aegis.cybershield-llc.com` | Used in cert URLs and sim links |

After adding: Deployments → latest → ⋯ → Redeploy

### Step 5 — Custom domain + Cloudflare DNS
**Vercel:** Settings → Domains → Add `aegis.cybershield-llc.com`  
**Cloudflare DNS:**
- Type: `CNAME`
- Name: `aegis`
- Target: `cname.vercel-dns.com`
- Proxy: **OFF** (grey cloud)

---

## URL Map

| URL | Purpose |
|---|---|
| `aegis.cybershield-llc.com` | Registration landing page |
| `/training` | Role selector |
| `/training/general` | 8-module general awareness track |
| `/training/technical` | 6-module DevSecOps track (gated on general) |
| `/verify/AGS-YYYY-XXXXXXXXXX` | Public certificate verification page |
| `/admin` | Admin dashboard (Basic Auth) |
| `/phished` | Post-simulation awareness debrief |
| `/sim/:token` | Phishing simulation click handler |
| `/api/register` | Enrollment API |
| `/api/complete` | Certificate issuance + phish scheduling |
| `/api/cert/:certId` | Certificate verification API (JSON) |
| `/api/cron/send-phish` | Scheduled phish email dispatch (cron) |
| `/api/admin/stats` | Dashboard data API |

---

## End-to-End Test

```
1. Go to aegis.cybershield-llc.com
2. Register: your name, email, org, Developer role
3. → Redirects to /training (role selector)
4. Select Developer → Begin General Track
5. Complete all 8 modules + quizzes
6. Certificate issues → verify link appears
7. Click "Continue to Technical Track" (dev role)
8. Complete 6 technical modules
9. Second certificate issues
10. Wait 30 min → check inbox for phish email
11. Visit /admin → login → verify both records show
12. Click /verify/<certId> → verify page shows valid certificate
```

---

## Admin Dashboard
URL: `aegis.cybershield-llc.com/admin`  
Login with `ADMIN_USER` / `ADMIN_PASS` from Vercel env vars.

Shows: enrollment counts, completion rates, phish sent/clicked/attempted, breakdown by role/platform, recent certificates with verify links, CSV export for insurance/audit documentation.

---

## Deploy Workflow
```bash
# Make changes
git add .
git commit -m "describe change"
git push
# Vercel deploys in ~30 seconds
```

---

## Environment Variables Reference
| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RESEND_API_KEY` | Yes | — | Resend sending API key |
| `ADMIN_USER` | Yes | open | Dashboard username |
| `ADMIN_PASS` | Yes | open | Dashboard password |
| `KV_REST_API_URL` | Auto | — | Set by Vercel KV link |
| `KV_REST_API_TOKEN` | Auto | — | Set by Vercel KV link |
| `PHISH_DELAY_MINUTES` | No | 30 | Minutes after cert before phish sends |
| `AEGIS_BASE_URL` | No | https://aegis.cybershield-llc.com | Base URL for links |
| `CRON_SECRET` | Auto | — | Set by Vercel for cron auth |

---

*CyberShield Technologies LLC · chris@cybershield-llc.com · Woodstock, GA*
