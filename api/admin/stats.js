/**
 * AEGIS — GET /api/admin/stats
 * Returns campaign data for the admin dashboard.
 * Protected by username:password Basic Auth (ADMIN_USER / ADMIN_PASS env vars).
 */

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  if (!checkAuth(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Aegis Admin"');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [tokenKeys, certKeys] = await Promise.all([
      kv.keys('token:*'),
      kv.keys('cert:*'),
    ]);

    const [tokenRecords, certRecords] = await Promise.all([
      Promise.all(tokenKeys.map(k => kv.get(k).catch(() => null))),
      Promise.all(certKeys.map(k => kv.get(k).catch(() => null))),
    ]);

    const enrollments = tokenRecords.filter(Boolean);
    const certs       = certRecords.filter(Boolean);

    const genComplete  = enrollments.filter(r => r.general_complete);
    const techComplete = enrollments.filter(r => r.technical_complete);
    const phishSent    = enrollments.filter(r => r.phish_sent);
    const clicked      = enrollments.filter(r => r.clicked);
    const attempted    = enrollments.filter(r => r.attempted_login);

    const stats = {
      // Enrollment
      total_enrolled:         enrollments.length,
      general_complete:       genComplete.length,
      technical_complete:     techComplete.length,
      certs_issued:           certs.length,
      general_completion_rate: enrollments.length
        ? pct(genComplete.length, enrollments.length) : 0,

      // Phishing
      phish_sent:             phishSent.length,
      phish_pending:          enrollments.filter(r => r.phish_scheduled && !r.phish_sent).length,
      clicked:                clicked.length,
      attempted_login:        attempted.length,
      click_rate:             phishSent.length ? pct(clicked.length, phishSent.length) : 0,
      attempt_rate:           clicked.length ? pct(attempted.length, clicked.length) : 0,

      // Breakdowns
      by_role:                countBy(enrollments, 'role'),
      by_industry:            countBy(enrollments, 'industry'),
      by_platform:            countBy(enrollments, 'platform'),
      by_org:                 countBy(enrollments, 'org'),

      // Recent enrollments (last 50)
      recent_enrollments: enrollments
        .sort((a,b) => new Date(b.registered_at) - new Date(a.registered_at))
        .slice(0, 50)
        .map(r => ({
          name:               r.name,
          email:              r.email,
          org:                r.org || '—',
          role:               r.role || '—',
          industry:           r.industry || '—',
          registered_at:      r.registered_at,
          general_complete:   r.general_complete,
          general_score:      r.general_score,
          general_total:      r.general_total,
          technical_complete: r.technical_complete,
          cert_id:            r.cert_id || null,
          phish_sent:         r.phish_sent,
          phish_send_after:   r.phish_send_after,
          clicked:            r.clicked,
          clicked_at:         r.clicked_at || null,
          attempted:          r.attempted_login,
        })),

      // Recent certs
      recent_certs: certs
        .sort((a,b) => new Date(b.issued_at) - new Date(a.issued_at))
        .slice(0, 25)
        .map(c => ({
          cert_id:   c.cert_id,
          name:      c.name,
          org:       c.org || '—',
          track:     c.track_label,
          score:     `${c.score}/${c.total_q} (${c.pct}%)`,
          issued_at: c.issued_at,
        })),

      generated_at: new Date().toISOString(),
    };

    return res.status(200).json(stats);
  } catch(e) {
    console.error('[stats]', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

function checkAuth(req) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) return true; // no env vars set = open during dev

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const [u, p]  = decoded.split(':');
    return u === user && p === pass;
  } catch { return false; }
}

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
function countBy(arr, key) {
  return arr.reduce((acc, item) => {
    const v = item[key] || 'unknown';
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
