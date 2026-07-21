/**
 * AEGIS — GET /api/cron/keepalive
 * ─────────────────────────────────────────────────────────────────────────────
 * Purpose: prevent the free-tier Upstash Redis database from being
 * auto-archived/deleted for inactivity (Upstash free tier archives after
 * 14 days idle, deletes shortly after if not restored — this happened once
 * already, see CLAUDE.md incident log).
 *
 * Runs daily via Vercel Cron (Hobby plan allows daily cron jobs — see
 * vercel.json "crons" entry). A trivial KV write is enough to count as
 * activity and reset the inactivity clock.
 *
 * Protected by CRON_SECRET, same pattern as the other cron endpoint.
 * Vercel automatically sends this header when calling registered cron routes.
 */

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = req.headers['authorization'];
    if (provided !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const now = new Date().toISOString();

  try {
    await kv.set('__keepalive', now, { ex: 60 * 60 * 24 * 30 }); // 30-day TTL, self-refreshing
    const check = await kv.get('__keepalive');
    return res.status(200).json({ ok: true, ts: now, verified: check === now });
  } catch (e) {
    console.error('[keepalive] KV error:', e.message);
    return res.status(500).json({ ok: false, error: e.message, ts: now });
  }
}
