const { sendCode, verifyCode, resetPassword, changeEmail, isEmail } = require('../server/passwordReset');

// Browsers allowed to call this API. Add your own origins via ALLOWED_ORIGINS (comma-separated).
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
  const email = String(body.email || '').trim().toLowerCase();
  if (!isEmail(email)) return send(res, 400, { ok: false, error: 'Please enter a valid email address.' });

  try {
    let r;
    if (body.action === 'send') r = await sendCode(email);
    else if (body.action === 'verify') r = await verifyCode(email, String(body.code || ''));
    else if (body.action === 'reset') r = await resetPassword(email, String(body.resetToken || ''), body.newPassword);
    else if (body.action === 'change-email') r = await changeEmail(body.idToken, String(body.kind || ''), String(body.id || ''), email);
    else r = { status: 400, body: { ok: false, error: 'Unknown action.' } };
    return send(res, r.status, r.body);
  } catch (e) {
    console.error('[password-reset]', body.action, e && e.message);
    if (e && /Missing server env var/.test(e.message || '')) return send(res, 500, { ok: false, error: 'Email service is not set up on the server yet (missing ' + e.message.split(': ').pop() + ' in Vercel Environment Variables).' });
    return send(res, 500, { ok: false, error: 'Server error. Please try again in a moment.' });
  }
};
