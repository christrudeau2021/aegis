/**
 * AEGIS — GET /api/cron/send-phish
 * ─────────────────────────────────────────────────────────────────────────────
 * Vercel cron job (runs every 15 minutes per vercel.json).
 * Scans KV for enrollments where:
 *   - phish_scheduled = true
 *   - phish_sent = false
 *   - phish_send_after <= now
 * Sends the phishing simulation email and marks phish_sent = true.
 *
 * This is how we decouple the phish send from training completion —
 * the training sets a future timestamp, the cron fires when time is up.
 *
 * Protected by CRON_SECRET header (set in Vercel dashboard).
 * Vercel automatically sends this header when calling cron endpoints.
 *
 * ENV:
 *   RESEND_API_KEY      — Resend sending key
 *   CRON_SECRET         — Vercel sets this automatically for cron routes
 *   AEGIS_BASE_URL      — base URL for simulation links
 */

import { kv } from '@vercel/kv';

const RECORD_TTL = 60 * 60 * 24 * 90;
const BASE_URL   = process.env.AEGIS_BASE_URL || 'https://aegis.cybershield-llc.com';

const PHISH_SUBJECTS = {
  gmail:            'Action required: Verify your Google account access',
  google_workspace: 'Action required: Verify your Google Workspace account',
  m365:             'Your Microsoft 365 session requires re-verification',
  ms_personal:      'Unusual sign-in activity on your Microsoft account',
  generic:          'Secure document shared with you — action required',
};

export default async function handler(req, res) {
  // Verify this is called by Vercel cron (or manually with the secret)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = req.headers['authorization'];
    if (provided !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (req.method !== 'GET') return res.status(405).end();

  const now = new Date();
  let scanned = 0, sent = 0, errors = 0;

  try {
    const keys = await kv.keys('token:*');
    scanned = keys.length;

    for (const key of keys) {
      try {
        const record = await kv.get(key);
        if (!record) continue;
        if (!record.phish_scheduled) continue;
        if (record.phish_sent) continue;
        if (!record.phish_send_after) continue;
        if (new Date(record.phish_send_after) > now) continue;

        // Time to fire
        await sendPhishEmail(record);

        record.phish_sent    = true;
        record.phish_sent_at = now.toISOString();
        await kv.set(key, record, { ex: RECORD_TTL });
        sent++;
        console.log(`[cron] phish sent to ${record.email}`);
      } catch(e) {
        errors++;
        console.error(`[cron] error processing ${key}:`, e.message);
      }
    }
  } catch(e) {
    console.error('[cron] scan error:', e.message);
    return res.status(500).json({ error: 'Scan failed', message: e.message });
  }

  return res.status(200).json({ scanned, sent, errors, ts: now.toISOString() });
}

// ── EMAIL BUILDER ──────────────────────────────────────────────────────────────
async function sendPhishEmail(record) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.error('[cron] RESEND_API_KEY not set'); return; }

  const simUrl  = `${BASE_URL}/sim/${record.token}`;
  const subject = PHISH_SUBJECTS[record.platform] || PHISH_SUBJECTS.generic;
  const html    = buildPhishHtml(record.name, record.email, record.platform, simUrl);
  const from    = getFrom(record.platform);

  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from, to:[record.email], subject, html }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Resend ${r.status}: ${err}`);
  }
}

function getFrom(platform) {
  const names = {
    gmail:'Google Security', google_workspace:'Google Workspace Security',
    m365:'Microsoft Account Team', ms_personal:'Microsoft Security',
    generic:'Secure Document Services',
  };
  return `${names[platform]||'Security Notification'} <security-noreply@cybershield-llc.com>`;
}

function buildPhishHtml(name, email, platform, simUrl) {
  const first = name.split(' ')[0];
  const T = {
    gmail: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="padding:20px 0;border-bottom:1px solid #e0e0e0;">
        <span style="font-size:22px;font-weight:700;color:#4285F4;">G</span><span style="font-size:22px;color:#EA4335;">o</span><span style="font-size:22px;color:#FBBC05;">o</span><span style="font-size:22px;color:#4285F4;">g</span><span style="font-size:22px;color:#34A853;">l</span><span style="font-size:22px;color:#EA4335;">e</span>
      </div>
      <div style="padding:32px 0;">
        <h2 style="color:#202124;font-weight:400;font-size:24px;margin-bottom:16px;">Security alert</h2>
        <p style="color:#5f6368;font-size:14px;line-height:1.6;">Hi ${first},</p>
        <p style="color:#5f6368;font-size:14px;line-height:1.6;">We detected unusual activity on your Google Account. Verify your identity within <strong style="color:#202124;">24 hours</strong> to maintain access.</p>
        <div style="margin:28px 0;"><a href="${simUrl}" style="background:#1a73e8;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500;">Verify Account</a></div>
        <p style="color:#80868b;font-size:12px;">If you didn't request this, you can ignore this email.</p>
      </div>
      <div style="padding:16px 0;border-top:1px solid #e0e0e0;"><p style="color:#80868b;font-size:11px;">Google LLC, 1600 Amphitheatre Pkwy, Mountain View, CA 94043</p></div>
    </div>`,

    google_workspace: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="padding:20px 0;border-bottom:1px solid #e0e0e0;">
        <span style="font-size:18px;font-weight:600;color:#4285F4;">Google</span> <span style="font-size:18px;color:#5f6368;">Workspace</span>
      </div>
      <div style="padding:32px 0;">
        <h2 style="color:#202124;font-weight:400;font-size:22px;margin-bottom:16px;">Workspace security alert</h2>
        <p style="color:#5f6368;font-size:14px;line-height:1.6;">Hi ${first},</p>
        <p style="color:#5f6368;font-size:14px;line-height:1.6;">Your Workspace administrator requires re-verification of your account access.</p>
        <div style="margin:28px 0;"><a href="${simUrl}" style="background:#1a73e8;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500;">Verify Account</a></div>
        <p style="color:#80868b;font-size:12px;">Sent to ${email} by your Workspace administrator.</p>
      </div>
    </div>`,

    m365: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#0078d4;padding:16px 24px;"><span style="color:#fff;font-size:18px;font-weight:600;">Microsoft</span></div>
      <div style="padding:32px 24px;background:#fff;">
        <h2 style="color:#0078d4;font-size:20px;font-weight:600;margin-bottom:16px;">Action required: Verify your Microsoft 365 account</h2>
        <p style="color:#323130;font-size:14px;line-height:1.6;">Hi ${first},</p>
        <p style="color:#323130;font-size:14px;line-height:1.6;">Your Microsoft 365 session has expired. Re-verification is required to maintain access to your organization's apps and services.</p>
        <div style="margin:24px 0;"><a href="${simUrl}" style="background:#0078d4;color:#fff;padding:12px 28px;border-radius:2px;text-decoration:none;font-size:14px;font-weight:600;">Sign In</a></div>
        <p style="color:#605e5c;font-size:12px;">If you didn't request this, contact your IT administrator.</p>
      </div>
      <div style="padding:14px 24px;background:#f3f2f1;"><p style="color:#605e5c;font-size:11px;margin:0;">Microsoft Corporation · One Microsoft Way · Redmond, WA 98052</p></div>
    </div>`,

    ms_personal: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="padding:20px 0;border-bottom:2px solid #0078d4;"><span style="color:#0078d4;font-size:20px;font-weight:700;">Microsoft</span></div>
      <div style="padding:32px 0;">
        <h2 style="color:#1b1b1b;font-size:22px;font-weight:300;margin-bottom:16px;">Unusual sign-in activity</h2>
        <p style="color:#1b1b1b;font-size:14px;line-height:1.6;">Hi ${first},</p>
        <p style="color:#1b1b1b;font-size:14px;line-height:1.6;">We detected unusual sign-in activity on your Microsoft account. Please review and verify your account to secure it.</p>
        <div style="margin:24px 0;"><a href="${simUrl}" style="background:#0078d4;color:#fff;padding:12px 28px;border-radius:2px;text-decoration:none;font-size:14px;">Review Activity</a></div>
      </div>
    </div>`,

    generic: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#07111f;padding:18px 24px;"><span style="color:#3b9eff;font-size:16px;font-weight:600;">🔒 Secure Document Portal</span></div>
      <div style="padding:32px 24px;background:#fff;">
        <h2 style="color:#07111f;font-size:20px;margin-bottom:16px;">A confidential document requires your attention</h2>
        <p style="color:#444;font-size:14px;line-height:1.6;">Hi ${first},</p>
        <p style="color:#444;font-size:14px;line-height:1.6;">A confidential document has been shared with you through our secure portal. Verify your identity to access it. This link expires in <strong>24 hours</strong>.</p>
        <div style="margin:24px 0;"><a href="${simUrl}" style="background:#07111f;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600;">Access Secure Document</a></div>
      </div>
    </div>`,
  };
  return T[platform] || T.generic;
}
