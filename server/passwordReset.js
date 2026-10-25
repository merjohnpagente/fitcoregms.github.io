'use strict';
// ============================================================
// FitCore GMS — password reset via 6-digit Gmail OTP (server-side)
// The code is generated, hashed, stored, verified and expired HERE,
// never in the browser. The browser only ever sees the final result.
// ============================================================
const crypto = require('crypto');
const admin = require('firebase-admin');

const CODE_TTL_MS = 5 * 60 * 1000;      // code valid 5 minutes
const RESET_TTL_MS = 10 * 60 * 1000;    // after verify, 10 minutes to set new password
const RESEND_COOLDOWN_MS = 60 * 1000;   // 1 send per minute per email
const MAX_ATTEMPTS = 5;                 // wrong-code tries before the code is burned
const COLLECTION = 'passwordResets';    // admin SDK only (client rules deny it)

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error('Missing server env var: ' + name);
  return v;
}

function init() {
  if (!admin.apps.length) {
    const sa = JSON.parse(env('FIREBASE_SERVICE_ACCOUNT'));
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return { auth: admin.auth(), db: admin.firestore() };
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hmac = (s) => crypto.createHmac('sha256', env('RESET_SECRET')).update(String(s)).digest('hex');
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

// Find the Firebase Auth account for a real email. Works when the Auth login
// email IS the Gmail, or when the Gmail is only stored on the member/user profile.
async function resolveTarget(email, { auth, db }) {
  let authEmail = null, uid = null;
  try { const u = await auth.getUserByEmail(email); uid = u.uid; authEmail = u.email; } catch (e) { /* try profiles */ }

  let profile = null, kind = null;
  for (const col of ['members', 'users']) {
    for (const field of uid ? ['authEmail', 'email'] : ['email', 'authEmail']) {
      const snap = await db.collection(col).where(field, '==', email).limit(1).get();
      if (!snap.empty) { profile = { id: snap.docs[0].id, ...snap.docs[0].data() }; kind = col; break; }
    }
    if (profile) break;
  }
  if (!uid && profile && profile.authEmail) {
    try { const u = await auth.getUserByEmail(String(profile.authEmail).toLowerCase()); uid = u.uid; authEmail = u.email; } catch (e) { /* none */ }
  }
  if (!uid) return null;
  const name = (profile && profile.name) || '';
  const label = kind === 'members' ? 'member' : ((profile && profile.role) || 'user');
  return { uid, authEmail, name: name || email.split('@')[0], label, profile: profile ? { kind, id: profile.id } : null };
}

// Sends through EmailJS's REST API from the SERVER (so the code never touches the browser).
// Your existing template variables are kept: to_email, to_name, username, otp_code, from_name, message.
// Needs: EmailJS dashboard -> Account -> Security -> allow API calls from non-browser apps,
// and EMAILJS_PRIVATE_KEY (Account -> API keys -> Private Key).
async function sendEmailJs(to, name, label, code) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID || 'service_qzaheib',
      template_id: process.env.EMAILJS_TEMPLATE_ID || 'template_cwn0ver',
      user_id: process.env.EMAILJS_PUBLIC_KEY || 'G6l2ttn_xjztBJVM6',
      accessToken: env('EMAILJS_PRIVATE_KEY'),
      template_params: {
        to_email: to,
        to_name: name,
        username: name,
        user_role: label,
        otp_code: code,
        from_name: 'FitCore GMS',
        message: 'Your FitCore verification code is ' + code + ' (valid 5 minutes). Do not share this code.'
      }
    })
  });
  if (!res.ok) throw new Error('EmailJS ' + res.status + ': ' + (await res.text()).slice(0, 200));
}

async function sendCode(email) {
  const ctx = init();
  const ref = ctx.db.collection(COLLECTION).doc(sha256(email));
  const cur = await ref.get();
  const now = Date.now();
  if (cur.exists) {
    const wait = (cur.data().lastSentAt || 0) + RESEND_COOLDOWN_MS - now;
    if (wait > 0) return { status: 200, body: { ok: true, cooldown: Math.ceil(wait / 1000) } };
  }
  const target = await resolveTarget(email, ctx);
  // Same response whether or not the account exists (no account enumeration).
  if (!target) return { status: 200, body: { ok: true, cooldown: RESEND_COOLDOWN_MS / 1000 } };

  const code = String(crypto.randomInt(100000, 1000000));
  await ref.set({
    codeHash: hmac(email + ':' + code), codeExp: now + CODE_TTL_MS, attempts: 0,
    lastSentAt: now, uid: target.uid, authEmail: target.authEmail,
    profile: target.profile || null, resetHash: null, resetExp: 0
  });
  try {
    await sendEmailJs(email, target.name, target.label, code);
  } catch (e) {
    // Don't lock the user out of retrying (60s cooldown) when the email never left.
    try { await ref.delete(); } catch (e2) { /* ignore */ }
    console.error('[password-reset] email send failed:', e && e.message);
    return { status: 502, body: { ok: false, error: 'Could not send the email code right now (email service error). Please try again later.' } };
  }
  return { status: 200, body: { ok: true, cooldown: RESEND_COOLDOWN_MS / 1000 } };
}

async function verifyCode(email, code) {
  const ctx = init();
  const ref = ctx.db.collection(COLLECTION).doc(sha256(email));
  const snap = await ref.get();
  const bad = (msg) => ({ status: 400, body: { ok: false, error: msg } });
  if (!snap.exists) return bad('Invalid or expired code. Please request a new one.');
  const d = snap.data();
  if (!d.codeHash || Date.now() > d.codeExp) return bad('Code expired. Please tap Resend to get a new one.');
  if ((d.attempts || 0) >= MAX_ATTEMPTS) return bad('Too many wrong attempts. Please request a new code.');
  if (!/^\d{6}$/.test(code) || !safeEq(hmac(email + ':' + code), d.codeHash)) {
    await ref.update({ attempts: (d.attempts || 0) + 1 });
    return bad('Invalid code. Please check and try again.');
  }
  const token = crypto.randomBytes(32).toString('hex');
  await ref.update({ codeHash: null, resetHash: sha256(token), resetExp: Date.now() + RESET_TTL_MS });
  return { status: 200, body: { ok: true, resetToken: token } };
}

async function resetPassword(email, token, newPassword) {
  const ctx = init();
  const ref = ctx.db.collection(COLLECTION).doc(sha256(email));
  const snap = await ref.get();
  const bad = (msg, status) => ({ status: status || 400, body: { ok: false, error: msg } });
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) return bad('Password must be at least 8 characters.');
  if (!snap.exists) return bad('Verification expired. Please verify again.');
  const d = snap.data();
  if (!d.resetHash || Date.now() > d.resetExp || !safeEq(sha256(token || ''), d.resetHash)) return bad('Verification expired. Please verify again.');

  await ctx.auth.updateUser(d.uid, { password: newPassword });
  await ctx.auth.revokeRefreshTokens(d.uid);            // sign out other devices
  await ref.delete();                                    // one-time use
  if (d.profile && d.profile.kind && d.profile.id) {     // clear "must change password" flag
    try { await ctx.db.collection(d.profile.kind).doc(d.profile.id).update({ mustChangePassword: false }); } catch (e) { /* non-fatal */ }
  }
  return { status: 200, body: { ok: true } };
}

module.exports = { sendCode, verifyCode, resetPassword, isEmail };
