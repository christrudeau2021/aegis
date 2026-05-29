/**
 * AEGIS — POST /api/register
 * Intake only. Detects email platform, writes enrollment record.
 * Phish email is scheduled by /api/complete after training is done.
 */

import { kv } from '@vercel/kv';

const RECORD_TTL = 60 * 60 * 24 * 90; // 90 days

const PERSONAL_DOMAINS = {
  'gmail.com':'gmail','googlemail.com':'gmail',
  'outlook.com':'ms_personal','hotmail.com':'ms_personal','hotmail.co.uk':'ms_personal',
  'live.com':'ms_personal','live.co.uk':'ms_personal','msn.com':'ms_personal',
  'yahoo.com':'generic','yahoo.co.uk':'generic','icloud.com':'generic',
  'me.com':'generic','mac.com':'generic','protonmail.com':'generic','proton.me':'generic',
};

const MX_PATTERNS = [
  { fragment:'google.com',             platform:'google_workspace' },
  { fragment:'googlemail.com',         platform:'google_workspace' },
  { fragment:'aspmx',                  platform:'google_workspace' },
  { fragment:'protection.outlook.com', platform:'m365' },
  { fragment:'mail.protection',        platform:'m365' },
  { fragment:'outlook.com',            platform:'m365' },
  { fragment:'mimecast.com',           platform:'generic' },
  { fragment:'pphosted.com',           platform:'generic' },
  { fragment:'barracuda',              platform:'generic' },
];

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, org, industry, role, consent } = req.body || {};
  const cleanName     = san(name,     100);
  const cleanEmail    = san(email,    254)?.toLowerCase();
  const cleanOrg      = san(org,      200) || '';
  const cleanIndustry = san(industry, 100) || '';
  const cleanRole     = san(role,     100) || '';

  if (!cleanName || !cleanEmail || consent !== true)
    return res.status(400).json({ error: 'Name, email and consent are required.' });
  if (!validEmail(cleanEmail))
    return res.status(400).json({ error: 'Please enter a valid email address.' });

  // Idempotency — return existing token so they can resume
  try {
    const existing = await kv.get(`email:${cleanEmail}`);
    if (existing) return res.status(200).json({ success:true, token:existing, redirect:'/training' });
  } catch (_) {}

  const platform = await detectPlatform(cleanEmail);
  const token    = genToken();

  const record = {
    token, name:cleanName, email:cleanEmail, org:cleanOrg,
    industry:cleanIndustry, role:cleanRole, platform,
    registered_at: new Date().toISOString(),
    general_complete:false, general_score:null, general_total:null,
    technical_complete:false, technical_score:null, technical_total:null,
    cert_id:null, cert_issued_at:null,
    phish_scheduled:false, phish_send_after:null, phish_sent:false, phish_sent_at:null,
    clicked:false, clicked_at:null, clicked_ip:null, clicked_ua:null,
    attempted_login:false, attempted_at:null, email_entered:null,
  };

  await kv.set(`token:${token}`, record, { ex: RECORD_TTL });
  await kv.set(`email:${cleanEmail}`, token, { ex: RECORD_TTL });
  console.log(`[register] ${cleanEmail} | platform:${platform}`);

  return res.status(200).json({ success:true, token, redirect:'/training' });
}

async function detectPlatform(email) {
  const domain = email.split('@')[1];
  if (!domain) return 'generic';
  if (PERSONAL_DOMAINS[domain]) return PERSONAL_DOMAINS[domain];
  try {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers:{ Accept:'application/dns-json' }, signal:AbortSignal.timeout(3500) }
    );
    const data = await r.json();
    const mx = (data.Answer||[]).map(a=>(a.data||'').toLowerCase()).join(' ');
    for (const { fragment, platform } of MX_PATTERNS)
      if (mx.includes(fragment)) return platform;
  } catch(e) { console.warn('[register] MX lookup failed:', e.message); }
  return 'generic';
}

function genToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length<=254; }
function san(v, max) { return typeof v==='string' ? v.trim().slice(0,max).replace(/[<>]/g,'') : ''; }
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}
