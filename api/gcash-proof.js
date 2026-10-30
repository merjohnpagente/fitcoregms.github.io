const { submitGcashProof } = require('../server/gcashProof');

// Browsers allowed to call this API cross-origin. Same-origin (Vercel) needs no header.
const DEFAULT_ORIGINS = ['https://merjohnpagente.github.io'];

function cors(req, res) {
  const allowed = DEFAULT_ORIGINS.concat((process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
  const origin = req.headers.origin;
  if (origin && (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  try {
    const r = await submitGcashProof(body);
    return send(res, r.status, r.body);
  } catch (e) {
    console.error('[gcash-proof]', e && e.message);
    if (e && /Missing server env var/.test(e.message || '')) {
      return send(res, 500, { ok: false, error: 'GCash verification is not set up on the server yet (missing ' + e.message.split(': ').pop() + ' in Vercel Environment Variables).' });
    }
    if (e && e.configHint) return send(res, 500, { ok: false, error: e.message });
    const code = e && (e.code || (e.errorInfo && e.errorInfo.code));
    if (code === 7 || code === 'permission-denied' || code === 'PERMISSION_DENIED') {
      return send(res, 500, { ok: false, error: 'Server setup error: the Firebase service account has no permission for Firestore.' });
    }
    return send(res, 500, { ok: false, error: 'Server error. Please try again in a moment.' });
  }
};
