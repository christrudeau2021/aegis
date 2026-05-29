/**
 * AEGIS — POST /api/complete
 * Issues certificate and sends phishing email with a scheduled delay.
 * Uses Resend's scheduledAt parameter to fire the phish 30 min after cert issuance.
 * The hourly cron is a backup catch-all for any that slip through.
 *
 * Body: { token, track, score, totalQ }
 */

import { kv } from '@vercel/kv';

const RECORD_TTL = 60 * 60 * 24 * 90;
const CERT_TTL   = 60 * 60 * 24 * 365 * 5;
const BASE_URL   = process.env.AEGIS_BASE_URL || 'https://aegis.cybershield-llc.com';
const DELAY_MIN  = parseInt(process.env.PHISH_DELAY_MINUTES || '30', 10);

const PHISH_SUBJECTS = {
  gmail:            'Action required: Verify your Google account access',
  google_workspace: 'Action required: Verify your Google Workspace account',
  m365:             'Your Microsoft 365 session requires re-verification',
  ms_personal:      'Unusual sign-in activity on your Microsoft account',
  generic:          'Secure document shared with you — action required',
};

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { token, track, score, totalQ } = req.body || {};
  if (!token || !track || score == null || !totalQ)
    return res.status(400).json({ error: 'token, track, score, totalQ required' });
  if (!['general','technical'].includes(track))
    return res.status(400).json({ error: 'track must be general or technical' });

  let record;
  try {
    record = await kv.get(`token:${token}`);
  } catch(e) {
    return res.status(500).json({ error: 'Storage error' });
  }
  if (!record) return res.status(404).json({ error: 'Enrollment not found' });

  const now        = new Date();
  const certId     = genCertId(now);
  const pct        = totalQ > 0 ? Math.round((score / totalQ) * 100) : 0;
  const trackLabel = track === 'general' ? 'General Security Awareness' : 'Technical / DevSecOps';

  // Update enrollment record
  if (track === 'general') {
    record.general_complete = true;
    record.general_score    = score;
    record.general_total    = totalQ;
  } else {
    record.technical_complete = true;
    record.technical_score    = score;
    record.technical_total    = totalQ;
  }

  record.cert_id        = certId;
  record.cert_issued_at = now.toISOString();

  // Schedule phish on general completion (first time only)
  const sendAt = new Date(Date.now() + DELAY_MIN * 60 * 1000);
  if (track === 'general' && !record.phish_scheduled) {
    record.phish_scheduled  = true;
    record.phish_send_after = sendAt.toISOString();
    record.phish_sent       = false;

    // Send via Resend scheduledAt — fires at the future time server-side
    // Falls back to cron if Resend scheduled send isn't available on free tier
    const sent = await schedulePhishEmail(record, sendAt);
    if (sent) {
      record.phish_sent    = true;
      record.phish_sent_at = sendAt.toISOString();
      console.log(`[complete] phish scheduled via Resend for ${record.email} at ${sendAt.toISOString()}`);
    } else {
      console.log(`[complete] phish queued for cron delivery at ${sendAt.toISOString()}`);
    }
  }

  await kv.set(`token:${token}`, record, { ex: RECORD_TTL });

  // Store certificate
  const certRecord = {
    cert_id: certId, name: record.name, email: record.email,
    org: record.org || '', role: record.role || '', industry: record.industry || '',
    track, track_label: trackLabel, score, total_q: totalQ, pct,
    issued_at: now.toISOString(),
    issuer: 'CyberShield Technologies LLC',
    issuer_name: 'Chris Trudeau, CISSP · ISSAP · PCI-DSS ISA',
    verify_url: `${BASE_URL}/verify/${certId}`,
    general_complete: record.general_complete,
    technical_complete: record.technical_complete,
  };
  await kv.set(`cert:${certId}`, certRecord, { ex: CERT_TTL });
  await kv.set(`cert_email:${record.email}:${track}`, certId, { ex: CERT_TTL });

  console.log(`[complete] cert ${certId} issued for ${record.email} track:${track}`);

  return res.status(200).json({
    success: true, certId,
    certUrl: `${BASE_URL}/verify/${certId}`,
    name: record.name, org: record.org || '',
    role: record.role || '', track, trackLabel,
    score, totalQ, pct,
    issuedAt: now.toISOString(),
    bothComplete: record.general_complete && record.technical_complete,
  });
}

// ── RESEND SCHEDULED SEND ─────────────────────────────────────────────────────
// Resend supports scheduledAt on paid plans. On free tier this returns an error
// and we fall back to the hourly cron.
async function schedulePhishEmail(record, sendAt) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const simUrl  = `${BASE_URL}/sim/${record.token}`;
  const html    = buildPhishHtml(record.name, record.email, record.platform, simUrl);
  const subject = PHISH_SUBJECTS[record.platform] || PHISH_SUBJECTS.generic;
  const from    = getFrom(record.platform);

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [record.email], subject, html,
        scheduled_at: sendAt.toISOString(),
      }),
    });
    const data = await r.json();
    // If scheduledAt isn't supported (free tier), Resend returns an error
    if (!r.ok) {
      console.warn('[complete] Resend scheduledAt not available, falling back to cron:', data);
      return false;
    }
    return true;
  } catch(e) {
    console.error('[complete] Resend error:', e.message);
    return false;
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
    gmail:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="padding:20px 0;border-bottom:1px solid #e0e0e0;"><span style="font-size:22px;font-weight:700;color:#4285F4;">G</span><span style="font-size:22px;color:#EA4335;">o</span><span style="font-size:22px;color:#FBBC05;">o</span><span style="font-size:22px;color:#4285F4;">g</span><span style="font-size:22px;color:#34A853;">l</span><span style="font-size:22px;color:#EA4335;">e</span></div><div style="padding:32px 0;"><h2 style="color:#202124;font-weight:400;font-size:24px;margin-bottom:16px;">Security alert</h2><p style="color:#5f6368;font-size:14px;line-height:1.6;">Hi ${first},</p><p style="color:#5f6368;font-size:14px;line-height:1.6;">We detected unusual activity on your Google Account. Verify your identity within <strong style="color:#202124;">24 hours</strong> to maintain access.</p><div style="margin:28px 0;"><a href="${simUrl}" style="background:#1a73e8;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500;">Verify Account</a></div><p style="color:#80868b;font-size:12px;">If you didn't request this, you can ignore this email.</p></div><div style="padding:16px 0;border-top:1px solid #e0e0e0;"><p style="color:#80868b;font-size:11px;">Google LLC, 1600 Amphitheatre Pkwy, Mountain View, CA 94043</p></div></div>`,
    google_workspace:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="padding:20px 0;border-bottom:1px solid #e0e0e0;"><span style="font-size:18px;font-weight:600;color:#4285F4;">Google</span> <span style="font-size:18px;color:#5f6368;">Workspace</span></div><div style="padding:32px 0;"><h2 style="color:#202124;font-weight:400;font-size:22px;margin-bottom:16px;">Workspace security alert</h2><p style="color:#5f6368;font-size:14px;line-height:1.6;">Hi ${first},</p><p style="color:#5f6368;font-size:14px;line-height:1.6;">Your administrator requires re-verification of your account access.</p><div style="margin:28px 0;"><a href="${simUrl}" style="background:#1a73e8;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:500;">Verify Account</a></div><p style="color:#80868b;font-size:12px;">Sent to ${email} by your Workspace administrator.</p></div></div>`,
    m365:`<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#0078d4;padding:16px 24px;"><span style="color:#fff;font-size:18px;font-weight:600;">Microsoft</span></div><div style="padding:32px 24px;background:#fff;"><h2 style="color:#0078d4;font-size:20px;font-weight:600;margin-bottom:16px;">Action required: Verify your Microsoft 365 account</h2><p style="color:#323130;font-size:14px;line-height:1.6;">Hi ${first},</p><p style="color:#323130;font-size:14px;line-height:1.6;">Your session has expired and requires re-verification to maintain access.</p><div style="margin:24px 0;"><a href="${simUrl}" style="background:#0078d4;color:#fff;padding:12px 28px;border-radius:2px;text-decoration:none;font-size:14px;font-weight:600;">Sign In</a></div></div><div style="padding:14px 24px;background:#f3f2f1;"><p style="color:#605e5c;font-size:11px;margin:0;">Microsoft Corporation · One Microsoft Way · Redmond, WA 98052</p></div></div>`,
    ms_personal:`<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="padding:20px 0;border-bottom:2px solid #0078d4;"><span style="color:#0078d4;font-size:20px;font-weight:700;">Microsoft</span></div><div style="padding:32px 0;"><h2 style="color:#1b1b1b;font-size:22px;font-weight:300;margin-bottom:16px;">Unusual sign-in activity</h2><p style="color:#1b1b1b;font-size:14px;line-height:1.6;">Hi ${first},</p><p style="color:#1b1b1b;font-size:14px;line-height:1.6;">We detected unusual sign-in activity on your Microsoft account. Please review and verify.</p><div style="margin:24px 0;"><a href="${simUrl}" style="background:#0078d4;color:#fff;padding:12px 28px;border-radius:2px;text-decoration:none;font-size:14px;">Review Activity</a></div></div></div>`,
    generic:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;"><div style="background:#07111f;padding:18px 24px;"><span style="color:#3b9eff;font-size:16px;font-weight:600;">🔒 Secure Document Portal</span></div><div style="padding:32px 24px;background:#fff;"><h2 style="color:#07111f;font-size:20px;margin-bottom:16px;">A confidential document requires your attention</h2><p style="color:#444;font-size:14px;line-height:1.6;">Hi ${first},</p><p style="color:#444;font-size:14px;line-height:1.6;">A confidential document has been shared with you. Verify your identity to access it. This link expires in <strong>24 hours</strong>.</p><div style="margin:24px 0;"><a href="${simUrl}" style="background:#07111f;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:600;">Access Document</a></div></div></div>`,
  };
  return T[platform] || T.generic;
}

function genCertId(date) {
  const a = new Uint8Array(5);
  crypto.getRandomValues(a);
  const rand = Array.from(a).map(b=>b.toString(36).toUpperCase().padStart(2,'0')).join('').slice(0,10);
  return `AGS-${date.getFullYear()}-${rand}`;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
