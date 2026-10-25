const { sendCode, verifyCode, resetPassword, changeEmail, adminChangeUserEmail, adminIssueResetCode, adminSetMemberPassword, isEmail } = require('../server/passwordReset');

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
    else if (body.action === 'admin-change-email') r = await adminChangeUserEmail(body.idToken, String(body.id || ''), email);
    else if (body.action === 'admin-issue-code') r = await adminIssueResetCode(body.idToken, String(body.id || ''));
    else if (body.action === 'admin-set-password') r = await adminSetMemberPassword(body.idToken, String(body.id || ''), email, body.newPassword);
    else r = { status: 400, body: { ok: false, error: 'Unknown action.' } };
    return send(res, r.status, r.body);
  } catch (e) {
    console.error('[password-reset]', body.action, e && e.message);
    if (e && /Missing server env var/.test(e.message || '')) return send(res, 500, { ok: false, error: 'Email service is not set up on the server yet (missing ' + e.message.split(': ').pop() + ' in Vercel Environment Variables).' });
    if (e && e.configHint) return send(res, 500, { ok: false, error: e.message });
    // Firestore / Firebase Admin problems that are server setup issues, not user errors.
    const code = e && (e.code || e.errorInfo && e.errorInfo.code);
    if (code === 7 || code === 'permission-denied' || code === 'PERMISSION_DENIED') return send(res, 500, { ok: false, error: 'Server setup error: the Firebase service account has no permission for Firestore (enable Cloud Firestore API / give it the Firebase Admin role).' });
    if (code === 5 || code === 'NOT_FOUND') return send(res, 500, { ok: false, error: 'Server setup error: Firestore database was not found for the project in FIREBASE_SERVICE_ACCOUNT. Make sure the service account belongs to the same Firebase project as the app.' });
    if (e && /DECODER routines|PEM|private key|invalid_grant|Credential implementation/i.test(e.message || '')) return send(res, 500, { ok: false, error: 'Server setup error: FIREBASE_SERVICE_ACCOUNT private key is invalid. Generate a new key in Firebase Console and paste the full JSON in Vercel.' });
    return send(res, 500, { ok: false, error: 'Server error. Please try again in a moment.' });
  }
};
