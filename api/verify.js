/**
 * AEGIS — GET /api/verify (routed from /verify/:certId)
 * ─────────────────────────────────────────────────────────────────────────────
 * Public endpoint. Returns certificate data for display on the verification page.
 * No authentication required — this is intentionally public.
 *
 * The certId is extracted from the URL path: /verify/AGS-2025-XXXXXXXXXX
 */

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Extract certId from /verify/:certId rewrite
  const certId = (req.url?.split('/api/cert/')[1] || '').split('?')[0].trim();

  if (!certId || certId.length < 10) {
    return res.status(400).json({ error: 'Invalid certificate ID' });
  }

  try {
    const cert = await kv.get(`cert:${certId}`);
    if (!cert) {
      return res.status(404).json({ error: 'Certificate not found', certId });
    }

    // Return safe public fields only — no email or internal metadata
    return res.status(200).json({
      valid:         true,
      certId:        cert.cert_id,
      name:          cert.name,
      org:           cert.org || '',
      role:          cert.role || '',
      track:         cert.track,
      trackLabel:    cert.track_label,
      score:         cert.score,
      totalQ:        cert.total_q,
      pct:           cert.pct,
      issuedAt:      cert.issued_at,
      issuer:        cert.issuer,
      issuerName:    cert.issuer_name,
      verifyUrl:     cert.verify_url,
      bothComplete:  cert.general_complete && cert.technical_complete,
    });
  } catch(e) {
    console.error('[verify] KV error:', e.message);
    return res.status(500).json({ error: 'Verification service unavailable' });
  }
}
