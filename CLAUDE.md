# Aegis — Project Context for Claude

## What this is
CyberShield Technologies LLC's security awareness training and phishing simulation platform.
Owner: Chris Trudeau, CISSP · ISSAP · PCI-DSS ISA · chris@cybershield-llc.com · Woodstock, GA

**Live URL:** https://aegis.cybershield-llc.com
**GitHub:** https://github.com/christrudeau2021/aegis (branch: main)
**Vercel:** christrudeau2021s-projects/aegis · prj_h6o4SMlwAp2UEPVuf3YQNvB6YEvq · team_GnsUHU0IFghi3O5IrbPxvSzy
**Status:** Working MVP, currently free-tier infra (Vercel Hobby + Upstash free + Resend free). Explicitly NOT production-hardened yet — see Product Strategy Notes below for the plan to change that.

---

## Architecture (current, verified 2026-07-21)

```
Register (index.html)
  → POST /api/register — MX-detects email platform, writes KV record, returns token
  → /training (role selector)
  → /training/general (8 modules, all roles)
      → POST /api/complete (track:general) → certificate issued
                                            → phish email sent IMMEDIATELY (no delay — see note below)
  → /training/technical (6 modules, developer/devsecops only — gated on general complete)
      → POST /api/complete (track:technical) → second certificate issued, no phish trigger

phish email arrives (same request as training completion, not delayed)
  → /sim/:token → api/sim-click.js → validates token, marks clicked, serves platform-matched fake login page
  → user submits (password never read/sent, by design) → POST /api/sim-capture → logs attempt, emails admin alert
  → redirect → /phished debrief page

/verify/:certId → public certificate verification page
/admin → dashboard (Basic Auth: ADMIN_USER / ADMIN_PASS), backed by GET /api/admin/stats
```

**IMPORTANT — phish timing:** The original design intent was a 30-minute delay between training completion and the phishing test (so it doesn't feel instantaneous/scripted). This is NOT currently implemented. `api/complete.js` sends the Resend email synchronously in the same request as quiz completion. There is a fully-built delayed-send mechanism sitting unused in `api/cron/send-phish.js` (scans KV for `phish_scheduled && phish_send_after <= now`), but it is NOT registered in `vercel.json` and nothing in `register.js`/`complete.js` ever sets `phish_scheduled`/`phish_send_after`. This was abandoned in an earlier session because Resend's free tier doesn't support the `scheduled_at` param and Vercel Cron on Hobby only allows daily schedules (too coarse for a 30-minute delay). Chris has explicitly accepted instant-send for now (demo purposes). If revisiting: either upgrade Resend to a paid tier for `scheduled_at`, or build a proper minute-granularity queue (e.g. `qstash` from Upstash, which is designed for exactly this).

**Storage:** Vercel KV (Upstash Redis) — see "Upstash Free Tier Gotcha" incident below, this WILL recur without the keepalive cron.
**Email:** Resend — from `security-noreply@cybershield-llc.com` (domain verified in Resend).
**Cron:** ONE cron job exists: `/api/cron/keepalive`, daily at 12:00 UTC (`0 12 * * *` in vercel.json). This is intentional and required — see incident log. Hobby plan allows daily-or-less-frequent cron jobs (confirmed via Vercel docs, 2026-07-21); anything more frequent than daily fails deployment. Do NOT remove this cron job, and do NOT change its schedule to sub-daily.
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
login-pages/                  ← Platform-matched fake login pages (5 variants) — read via readFileSync from repo root, NOT public/
api/register.js               ← Intake, MX detect, KV write
api/complete.js               ← Certificate issuance + immediate Resend phish send
api/verify.js                 ← Certificate lookup (routed via /api/cert/:certId)
api/sim-click.js              ← Token validation → fake login redirect (reads login-pages/ at repo root)
api/sim-capture.js            ← Log credential attempt (password never read, by design)
api/admin/stats.js            ← Dashboard data (Basic Auth)
api/cron/keepalive.js         ← Daily KV write to prevent Upstash free-tier auto-archive (ACTIVE)
api/cron/send-phish.js        ← Delayed-send mechanism, built but UNUSED/unregistered — see phish timing note above
vercel.json                   ← Routes + ONE daily cron (keepalive)
package.json
```

**CRITICAL:** HTML files must stay at the repo root (not in a `public/` subdirectory). Vercel serves from root. `outputDirectory` must NOT be set in vercel.json or routing breaks.

**CRITICAL:** Any file under `api/` that reads other files from disk (readFileSync, etc.) must use `join(process.cwd(), 'relative/path')` — NOT `join(process.cwd(), 'public', 'relative/path')`. There is no `public/` directory in this repo. This exact mistake broke the phishing simulation click-through for an unknown period before being caught 2026-07-21 (see incident log).

**CRITICAL:** vercel.json crons must stay at daily-or-coarser granularity. Hobby plan rejects sub-daily schedules at deploy time (the whole deploy fails, not just the cron). The current keepalive cron (`0 12 * * *`) is safe. Don't add more frequent cron jobs without upgrading the Vercel plan.

---

## Environment Variables (Vercel dashboard → Settings → Environments → Production)

| Variable | Purpose | Notes |
|---|---|---|
| `RESEND_API_KEY` | Resend sending key | |
| `ADMIN_USER` | Dashboard username | |
| `ADMIN_PASS` | Dashboard password | |
| `AEGIS_BASE_URL` | https://aegis.cybershield-llc.com | |
| `KV_REST_API_URL` | Upstash REST API URL | Points at whatever Upstash database is currently active — see incident log, this has been dead before |
| `KV_REST_API_TOKEN` | Upstash REST API token | |
| `KV_REST_API_READ_ONLY_TOKEN` | Upstash read-only token | Set by Upstash integration, not currently used by app code |
| `KV_URL` | Upstash Redis TCP URL | Not currently used by app code (app uses `@vercel/kv`, which only needs the two REST vars above) |
| `REDIS_URL` | Same as KV_URL | Duplicate, same reasoning |
| `PHISH_DELAY_MINUTES` | — | **ORPHANED.** Not referenced anywhere in the codebase. Leftover from an abandoned delayed-send attempt. Safe to ignore or delete. |
| `CRON_SECRET` | Optional | If set, protects both cron endpoints with a bearer token Vercel auto-attaches to cron-triggered requests. NOT currently set — both cron endpoints are callable by anyone who knows the URL. Low risk today (keepalive just writes a harmless timestamp; send-phish is unregistered/unused) but worth setting if this becomes a real product. |

**Do NOT reuse:** `aegis_01_REDIS_URL` — leftover from a Redis Cloud (not Upstash) database connected during troubleshooting on 2026-07-21. Redis Cloud is NOT compatible with `@vercel/kv` (different protocol — REST vs raw TCP). This database can be disconnected/deleted; the app does not and cannot use it without a code rewrite to a different Redis client.

---

## KV Data Model

| Key | TTL | Contents |
|---|---|---|
| `token:{token}` | 90 days | Full enrollment record |
| `email:{email}` | 90 days | → token (for idempotency) |
| `cert:{certId}` | 5 years | Certificate record |
| `cert_email:{email}:{track}` | 5 years | → certId |
| `__keepalive` | 30 days, self-refreshing daily | Written by api/cron/keepalive.js — just a timestamp, not app data |

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
| `/api/cron/keepalive` | Daily cron target (Vercel-invoked, also manually callable) |

---

## Training Content

**General Track (all roles, 8 modules):** Phishing anatomy, spotting attacks, data classification, access control, passwords/MFA, acceptable use, incident response, personal playbook. 3–4 quiz questions each. Role-personalized callout blocks for: executive, finance, hr, legal, it, operations, developer, devsecops.

**Technical Track (developer/devsecops only, 6 modules, gated on general completion):** T1 Identity in CI/CD, T2 Secrets & credentials, T3 Non-interactive auth, T4 Supply chain security, T5 SAST principles, T6 DAST & runtime. Policy corpus derived from ITSS (IBM IT Security Standard) with all IBM references removed.

**Content philosophy:** When building for a client, the training engine stays the same. Only the corpus (module content and quiz questions) changes to reflect the client's own policies and compliance requirements. See Product Strategy Notes for how this is planned to be packaged/sold.

---

## Certificate System

- Format: `AGS-YYYY-XXXXXXXXXX`
- Issued by: Chris Trudeau, CISSP · ISSAP · PCI-DSS ISA / CyberShield Technologies LLC
- Stored permanently in KV (5-year TTL)
- Publicly verifiable at `/verify/{certId}`
- Downloadable as PDF via `window.print()` on a styled hidden print div

---

## Phishing Simulation

- Triggered by `POST /api/complete` after general track completion (fires immediately — see phish timing note above)
- Platform-matched: gmail, google_workspace, m365, ms_personal, generic (detected via MX lookup at registration)
- Sim link: `/sim/{token}` → validates token → serves platform-matched fake login page (login-pages/ at repo root)
- Credential capture: architecturally impossible — sim-capture.js logs the attempt but never reads the password field value; client-side JS also never reads it (defense in depth)
- Results visible in admin dashboard (`/admin`)
- **Deliverability note:** the simulation email realistically triggers spam filters (new sending domain + urgent security-alert language impersonating Google/Microsoft). Confirmed via live test 2026-07-21: Resend reported "Delivered" but the email landed in Gmail's Spam folder, not the inbox. This is expected/realistic for a phishing simulation, but worth deliberate handling before selling to real clients — see Product Strategy Notes.

---

## Quiz JS Architecture (general.html / technical.html — critical notes)

The HTML and JS must use exactly these names — mismatches have caused multiple broken deployments historically:

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

## Deploy Workflow (as actually used in Cowork sessions)

Cowork sessions run in an ephemeral sandbox — a local git clone lives at `~/repos/aegis` inside the sandbox (NOT the connected project folder, which can't run git due to filesystem lock restrictions). Each new session needs a fresh GitHub fine-grained PAT (Contents: Read and write, scoped to this repo only) to re-clone.

```bash
cd ~/repos/aegis
git pull --ff-only
# ... edit with Read/Edit/Write tools or bash ...
git add -A
git commit -m "description"
git push origin main
# Vercel auto-deploys via GitHub webhook (~15-30 sec). Verify with list_deployments / get_deployment
# via the Vercel MCP tools rather than assuming — don't trust a push alone.
```

If working from a personal machine instead of Cowork: `cd ~/Downloads/aegis` (or wherever it's actually cloned), same git flow. If the GitHub webhook ever silently fails to trigger a deploy (has happened before): `npx vercel login` then `npx vercel --prod --force`.

---

## Incident Log (chronological — read before assuming something is "just broken")

### 2026-07-21 — Upstash free-tier database auto-archived, broke registration entirely
**Symptom:** `POST /api/register` throwing `TypeError: fetch failed` / `ENOENT ... cool-crappie-136904.upstash.io`.
**Root cause:** Upstash's free tier archives databases after 14 days of inactivity, then fully deletes them ~14 days after that if not restored. The original `aegis-kv` database had gone quiet and was deleted before anyone noticed — nothing wrong with the code, the database itself was just gone.
**Fix:** Created a new Upstash database (`upstash-kv-crimson-park`), manually copied its `KV_REST_API_URL` / `KV_REST_API_TOKEN` / `KV_URL` / `REDIS_URL` values into the existing (same-named) Vercel environment variables, redeployed. Also had to delete-and-recreate those env vars rather than edit in place, because they were still "owned" by the old dead Upstash integration and Vercel made them read-only in that state.
**Permanent fix:** Added `api/cron/keepalive.js`, a daily Vercel Cron job (`0 12 * * *`) that writes a trivial timestamp key to KV every day, well inside the 14-day inactivity window. This should prevent recurrence as long as the cron itself keeps firing — the weekly Cowork scheduled task "aegis-health-checkin" spot-checks this.
**Time cost before this fix existed:** ~3 hours of diagnosis + manual dashboard work. That's the whole reason this incident log exists — don't rediscover this from scratch.

### 2026-07-21 — Phishing simulation link 404'd (likely broken for a while, unknown how long)
**Symptom:** Clicking a phishing simulation link (`/sim/:token`) returned a blank "Not found" page instead of the fake login page. The click itself was still logged correctly (that happens before the broken code), but nothing past that point ever ran — no fake login shown, no credential-attempt capture, no admin alert, no `/phished` debrief.
**Root cause:** `api/sim-click.js` read template files from `join(process.cwd(), 'public', 'login-pages', file)`. This repo has no `public/` directory — `login-pages/` sits at the repo root. Every call threw `ENOENT`, caught, and silently returned a 404.
**Fix:** One-line change to `join(process.cwd(), 'login-pages', file)`. Verified live end-to-end afterward (registered a real test user, triggered completion, received the actual email — which landed in Spam, see Phishing Simulation section above — clicked the real link, confirmed the fake login page rendered, submitted, confirmed redirect to `/phished`, confirmed sim-capture and admin alert fired).

### 2026-07-21 — Header banner text
Changed "by CyberShield" to "by CyberShield Technologies, LLC" across index.html, training.html, tracks/general.html, tracks/technical.html (full legal entity name requested by Chris).

---

## Quick Diagnostic Runbook (for next time something looks broken)

1. **Registration or anything KV-related failing?** Check Vercel → aegis project → runtime errors for `ENOTFOUND`/`ENOENT`/`fetch failed` mentioning an `*.upstash.io` hostname. If found, the KV database is probably dead/archived again — check Storage tab for an "Archived due to inactivity" banner. If the keepalive cron (`/api/cron/keepalive`) has been firing (check runtime logs, query "keepalive"), this shouldn't happen — if it does anyway, the cron itself may have silently stopped; check Vercel's Cron Jobs settings page for its last-run status.
2. **Phishing link 404ing again?** Check for `ENOENT` errors mentioning a file path — if any new file-reading code got added under `api/`, verify it's NOT prefixing paths with `public/`.
3. **Email not arriving?** Check Resend dashboard (resend.com → Logs/Emails) for the specific message — Resend showing "Delivered" doesn't mean it reached the inbox; check spam folders before assuming it's broken.
4. **General approach:** `get_runtime_errors` and `get_runtime_logs` via the Vercel MCP tools are the fastest path to a root cause — check those before re-deriving everything from scratch by reading code.

---

## Product Strategy Notes (business context, not code — but relevant to what gets built next)

Chris's direction as of 2026-07-21: NOT pursuing per-seat SaaS licensing. Target model is a flat ~$5,000 setup/development fee plus ~$1,000/month retainer per client, sold directly (in-person pitch to boutique firms), positioned as ongoing managed service rather than self-serve software.

**Market research findings (see chat history 2026-07-21 for full detail and sources):**
- The "training + phishing simulation combined" mechanic is industry-standard (KnowBe4, Proofpoint, Hoxhunt, Cofense, etc. all already do this) — NOT a differentiator on its own.
- AI-driven persona personalization is also already a 2026 marketing point for multiple competitors.
- Building training content from a client's own uploaded policy document is closer to genuinely novel, but at least one competitor (Adaptive Security) is already doing it too — not unique, but not fully commoditized either.
- The real, well-evidenced gap: **73% of small businesses are failing cyber insurance assessments in 2026**, and security awareness training + documented phishing test results is one of the "big three" controls underwriters now require proof of (alongside MFA and EDR). This is a more concrete sales hook than "full cycle training" in the abstract — the pitch is insurability and provable compliance, not just training quality.
- Comparable pricing context: full vCISO retainers run $2,000–$20,000+/month; project-based security work runs $5,000–$50,000+. A $5,000 setup + $1,000/month retainer is priced well under a full vCISO engagement, which supports positioning Aegis as an accessible, narrowly-scoped add-on rather than a competitor to full vCISO services.

**Roadmap priorities identified (not yet built, in rough priority order):**
1. **Compliance-ready reporting export** — one-click, insurer-formatted PDF (completion certs + dated phishing test results + remediation records per employee) that a client hands directly to their broker at renewal. This is the actual deliverable that justifies recurring payment.
2. **IAM/roster automation** — SSO-based auto-provisioning/deprovisioning against Microsoft 365 or Google Workspace, so a client doesn't manually manage rosters. Currently registration is fully manual (one form per person).
3. **Living threat corpus** — tie campaign refreshes to real current attack trends per industry, not static templates, as the ongoing substance behind the monthly retainer.
4. **Policy ingestion, framed as white-glove service** — "we review your actual security policy once and build training around it," bundled into the $5,000 setup rather than marketed as a self-serve AI feature (avoids inviting direct comparison to funded competitors already doing this at scale).

**Before any of this goes in front of a real client:** infra needs to move off free-tier services (Vercel Hobby, Upstash free, Resend free/unverified sending reputation) — today's incidents are a direct preview of what breaks under a paying client's trust otherwise. Also: the credential-capture/click-tracking mechanics likely intersect with employee monitoring and consent-notice requirements that vary by state/country — flagged for real legal review before multi-client sales, not something either Chris or Claude should guess at.

---

## Known Issues / Past Failures (don't repeat these)

1. **`outputDirectory: public` in vercel.json** — breaks routing. Never set this. Files must be at repo root.
2. **Sub-daily cron expressions in vercel.json** — deployment fails entirely on Hobby plan. Daily (`0 12 * * *` etc.) is fine and is currently in use for the keepalive job — see above.
3. **JS function name mismatches** — multiple past deployments broke because the script used different names than the HTML's onclick handlers called. The script must define exactly the names the HTML calls (see Quiz JS Architecture table above).
4. **Element ID mismatches** — same category of bug as #3, but for JS reading `document.getElementById(...)`. Always verify against the actual HTML IDs.
5. **Vercel Deployment Protection** — was ON at one point, blocking all visitors. Check: Vercel → Settings → Deployment Protection → Disabled.
6. **GitHub webhook drops** — has happened before. Fix: `npx vercel login` then `npx vercel --prod --force`.
7. **`public/` path prefix in any `readFileSync`/`join(process.cwd(), ...)` call under `api/`** — there is no `public/` directory in this repo. Broke the phishing simulation for an unknown period (see incident log). Grep for `'public'` under `api/` if anything file-reading-related seems broken.
8. **Upstash free-tier 14-day auto-archive** — see incident log. Mitigated by the keepalive cron, but if that cron is ever removed "to clean things up," this WILL happen again.
