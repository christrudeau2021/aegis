# Aegis — Project Context for Claude

## What this is
CyberShield Technologies LLC's security awareness training and phishing simulation platform.
Owner: Chris Trudeau, CISSP · ISSAP · PCI-DSS ISA · chris@cybershield-llc.com · Woodstock, GA

**Live URL:** https://aegis.cybershield-llc.com  
**GitHub:** https://github.com/christrudeau2021/aegis (branch: main)  
**Vercel:** christrudeau2021s-projects/aegis · prj_h6o4SMlwAp2UEPVuf3YQNvB6YEvq · team_GnsUHU0IFghi3O5IrbPxvSzy  
**Current deployed version:** v8

---

## Architecture

```
Register (index.html)
  → /training (role selector)
  → /training/general (8 modules, all roles)
      → certificate issued via POST /api/complete
      → phish email scheduled via Resend scheduled_at (+30 min)
  → /training/technical (6 modules, developer/devsecops only — gated on general complete)
      → second certificate issued

[30 min later] phish email arrives → /sim/:token → fake login → /phished debrief
/verify/:certId → public certificate verification page
/admin → dashboard (Basic Auth: ADMIN_USER / ADMIN_PASS)
```

**Storage:** Vercel KV (Upstash Redis)  
**Email:** Resend — from security-noreply@cybershield-llc.com  
**Cron:** REMOVED — Hobby plan only allows daily. Phish sent directly via Resend `scheduled_at`.  
**Auth:** Basic Auth on /admin only.

---

## File Structure (all HTML at repo root — critical for Vercel routing)

```
index.html                    ← Registration + landing
training.html                 ← Role selector
tracks/general.html           ← 8-module general awareness track
tracks/technical.html         ← 6-module DevSecOps track
verify/index.html             ← Certificate verification UI
static/dashboard.html         ← Admin dashboard
static/phished.html           ← Post-simulation awareness page
login-pages/                  ← Platform-matched fake login pages (5 variants)
api/register.js               ← Intake, MX detect, KV write
api/complete.js               ← Certificate issuance + Resend phish scheduling
api/verify.js                 ← Certificate lookup (routed via /api/cert/:certId)
api/sim-click.js              ← Token validation → fake login redirect
api/sim-capture.js            ← Log credential attempt
api/admin/stats.js            ← Dashboard data (Basic Auth)
vercel.json                   ← Routes — NO outputDirectory, NO crons
package.json
```

**CRITICAL:** HTML files must stay at the repo root (not in a `public/` subdirectory). Vercel serves from root. `outputDirectory` must NOT be set in vercel.json or routing breaks.

**CRITICAL:** vercel.json must NOT have a `crons` block. Hobby plan only allows daily crons — any other schedule fails deployment entirely.

---

## Environment Variables (Vercel dashboard)

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend sending key |
| `ADMIN_USER` | Dashboard username |
| `ADMIN_PASS` | Dashboard password |
| `PHISH_DELAY_MINUTES` | Default 30 — minutes after cert before phish sends |
| `AEGIS_BASE_URL` | https://aegis.cybershield-llc.com |
| `KV_REST_API_URL` | Auto-set by Vercel KV |
| `KV_REST_API_TOKEN` | Auto-set by Vercel KV |

---

## KV Data Model

| Key | TTL | Contents |
|---|---|---|
| `token:{token}` | 90 days | Full enrollment record |
| `email:{email}` | 90 days | → token (for idempotency) |
| `cert:{certId}` | 5 years | Certificate record |
| `cert_email:{email}:{track}` | 5 years | → certId |

---

## URL Routes

| URL | Destination |
|---|---|
| `/sim/:token` | `/api/sim-click` |
| `/training` | `/training.html` |
| `/training/general` | `/tracks/general.html` |
| `/training/technical` | `/tracks/technical.html` |
| `/admin` | `/static/dashboard.html` |
| `/phished` | `/static/phished.html` |
| `/api/cert/:certId` | `/api/verify` |
| `/verify/:certId` | Served by Vercel from `verify/index.html` (no rewrite needed) |

---

## Training Content

**General Track (all roles, 8 modules):** Phishing anatomy, spotting attacks, data classification, access control, passwords/MFA, acceptable use, incident response, personal playbook. 3–4 quiz questions each. Role-personalized callout blocks for: executive, finance, hr, legal, it, operations, developer, devsecops.

**Technical Track (developer/devsecops only, 6 modules, gated on general completion):** T1 Identity in CI/CD, T2 Secrets & credentials, T3 Non-interactive auth, T4 Supply chain security, T5 SAST principles, T6 DAST & runtime. Policy corpus derived from ITSS (IBM IT Security Standard) with all IBM references removed.

**Content philosophy:** When building for a client, the training engine stays the same. Only the corpus (module content and quiz questions) changes to reflect the client's own policies and compliance requirements.

---

## Certificate System

- Format: `AGS-YYYY-XXXXXXXXXX`
- Issued by: Chris Trudeau, CISSP · ISSAP · PCI-DSS ISA / CyberShield Technologies LLC
- Stored permanently in KV (5-year TTL)
- Publicly verifiable at `/verify/{certId}`
- Downloadable as PDF via `window.print()` on a styled hidden print div

---

## Phishing Simulation

- Triggered by `POST /api/complete` after general track completion
- Sent via Resend with `scheduled_at` = now + PHISH_DELAY_MINUTES
- Platform-matched: gmail, google_workspace, m365, ms_personal, generic (detected via MX lookup at registration)
- Sim link: `/sim/{token}` → validates token → serves platform-matched fake login page
- Credential capture: architecturally impossible — sim-capture.js logs the attempt but never reads the password field value
- Results visible in admin dashboard

---

## Quiz JS Architecture (general.html — critical notes)

The HTML and JS must use exactly these names — mismatches have caused multiple broken deployments:

| HTML onclick | JS function | Notes |
|---|---|---|
| `toggleMod(id)` | `function toggleMod(id)` | Opens/closes module |
| `answer(this, qId, bool, modId)` | `function answer(btn, qId, correct, modId)` | Handles answer click |
| `completeMod(cur, next)` | `function completeMod(curId, nextId)` | Advances to next module |
| `finishTrack()` | `async function finishTrack()` | Calls /api/complete, shows cert |
| `downloadCert()` | `function downloadCert()` | Triggers print-to-PDF |

HTML element ID patterns the JS depends on (must not be renamed):
- `qcount-{modId}` — answered count display
- `score-{modId}` — score bar container
- `dots-{modId}` — dot indicators span
- `scoretext-{modId}` — "X of Y correct" text
- `{modId}-btn` — continue button (e.g. `mod1-btn`)
- `certName`, `certRole`, `certScore`, `certDate` — completion card
- `certPrintPage`, `printCertName`, `printCertRole`, `printCertScore`, `printCertDate`, `printCertId` — print page
- `progressText`, `progressFill` — progress bar
- `navRole` — nav role display
- `completionCard`, `techContinueBtn` — completion section

---

## Deploy Workflow

```bash
cd ~/Downloads/aegis
git add .
git commit -m "description"
git push
# Vercel auto-deploys via GitHub webhook (~30 sec)

# If webhook fails (has happened before):
npx vercel --prod --force
```

**Version history note:** Zip files have been saved as v6, v7, v8 locally. The repo is always current. When starting a new session, trust the repo state via GitHub — don't assume zip version numbers match session numbers.

---

## Known Issues / Past Failures (don't repeat these)

1. **`outputDirectory: public` in vercel.json** — breaks routing. Never set this. Files must be at repo root.
2. **Cron expressions other than daily (`0 0 * * *`) in vercel.json** — deployment fails on Hobby plan. Remove crons entirely; phish sends via Resend `scheduled_at`.
3. **JS function name mismatches** — three deployments broke because the script used `ans()`, `toggle()`, `complete()` but HTML called `answer()`, `toggleMod()`, `completeMod()`. The script must define exactly the names the HTML calls.
4. **Element ID mismatches** — script referenced `progFill` / `progTxt` / `sb-{id}` / `st-{id}` but HTML used `progressFill` / `progressText` / `score-{id}` / `scoretext-{id}`. Always verify against the actual HTML IDs.
5. **Vercel Deployment Protection** — was ON at one point, blocking all visitors. Check: Vercel → Settings → Deployment Protection → Disabled.
6. **GitHub webhook drops** — has happened twice. Fix: `npx vercel login` then `npx vercel --prod --force`.
