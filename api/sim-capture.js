/**
 * AEGIS — POST /api/sim-capture
 * ───────────────────────────────────────────────────────────────────────────
 * Logs a credential attempt event.
 *
 * CRITICAL SECURITY CONSTRAINT:
 * This endpoint accepts ONLY { token, email_entered }.
 * The fake login page intercepts the form submit client-side and strips
 * all password field values before POSTing here.
 * NO password is ever read, transmitted, stored, or logged — by design.
 */

import { kv } from '@vercel/kv';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const ADMIN_EMAIL       = 'chris@cybershield-llc.com';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, email_entered } = req.body || {};

  const cleanToken = sanitize(token, 32);
  const cleanEmail = sanitize(email_entered, 200);
  // PASSWORD FIELD EXPLICITLY IGNORED — DO NOT ADD password handling

  let record;
  try {
    record = await kv.get(`token:${cleanToken}`);
  } catch (err) {
    console.error('KV get error:', err);
    return res.status(200).json({ redirect: '/phished' });
  }

  if (!record) {
    return res.status(200).json({ redirect: '/phished' });
  }

  if (!record.attempted_login) {
    record.attempted_login = true;
    record.attempted_at    = new Date().toISOString();
    record.email_entered   = cleanEmail;

    try {
      await kv.set(`token:${cleanToken}`, record, { ex: TOKEN_TTL_SECONDS });
    } catch (err) {
      console.error('KV set error:', err);
    }

    // Alert admin
    await sendAdminAlert(record);
  }

  return res.status(200).json({ redirect: '/phished' });
}

async function sendAdminAlert(record) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const html = `
    <div style="font-family:monospace;max-width:520px;background:#07111f;color:#ddeeff;padding:24px;border-radius:8px;">
      <h2 style="color:#ef4444;font-size:16px;margin-bottom:16px;">⚠ Credential Attempt — Aegis Simulation</h2>
      <table style="width:100%;font-size:13px;line-height:2.2;">
        <tr><td style="color:#3b9eff;width:150px;">Name</td><td style="color:#fff;">${esc(record.name)}</td></tr>
        <tr><td style="color:#3b9eff;">Email</td><td style="color:#fff;">${esc(record.email)}</td></tr>
        <tr><td style="color:#3b9eff;">Organization</td><td style="color:#fff;">${esc(record.org || '—')}</td></tr>
        <tr><td style="color:#3b9eff;">Platform</td><td style="color:#fff;">${esc(record.platform)}</td></tr>
        <tr><td style="color:#3b9eff;">Registered</td><td style="color:#fff;">${esc(record.registered_at)}</td></tr>
        <tr><td style="color:#3b9eff;">Link Clicked</td><td style="color:#fff;">${esc(record.clicked_at || '—')}</td></tr>
        <tr><td style="color:#3b9eff;">Attempt At</td><td style="color:#fff;">${esc(record.attempted_at)}</td></tr>
        <tr><td style="color:#3b9eff;">Click IP</td><td style="color:#fff;">${esc(record.clicked_ip || '—')}</td></tr>
        <tr>
          <td style="color:#ef4444;font-weight:700;">PASSWORD CAPTURED</td>
          <td style="color:#22c55e;font-weight:700;">NONE — BY DESIGN</td>
        </tr>
      </table>
      <p style="color:#1e4060;font-size:11px;margin-top:20px;border-top:1px solid #1e4060;padding-top:12px;">
        CyberShield Aegis · Security Awareness Training Platform
      </p>
    </div>`;

  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Aegis Platform <notifications@cybershield-llc.com>',
      to:      [ADMIN_EMAIL],
      subject: `[Aegis] Credential attempt — ${record.name} (${record.org || record.email})`,
      html,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error('Admin alert send failed:', resp.status, err);
  }
}

function sanitize(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen).replace(/[<>]/g, '');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
