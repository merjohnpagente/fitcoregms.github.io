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

// Accepts the service account as raw JSON, JSON wrapped in quotes, or base64 —
// Vercel env vars are often pasted with stray quotes/newlines, which made
// JSON.parse throw and surfaced only as a generic "Server error".
function parseServiceAccount(raw) {
  let t = String(raw).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1).trim();
  if (t && t[0] !== '{') { try { t = Buffer.from(t, 'base64').toString('utf8').trim(); } catch (e) { /* fall through */ } }
  let sa;
  try { sa = JSON.parse(t); } catch (e) {
    const err = new Error('FIREBASE_SERVICE_ACCOUNT in Vercel is not valid JSON. Paste the whole service-account .json file content (starts with { and ends with }).');
    err.configHint = true; throw err;
  }
  if (!sa || !sa.private_key || !sa.client_email || !sa.project_id) {
    const err = new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id / client_email / private_key. Generate a new key in Firebase Console -> Project settings -> Service accounts.');
    err.configHint = true; throw err;
  }
  sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
  return sa;
}

function init() {
  if (!admin.apps.length) {
    const sa = parseServiceAccount(env('FIREBASE_SERVICE_ACCOUNT'));
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

// Change the logged-in user's own email. Verified by their Firebase ID token.
// Members/staff/trainers: the Firebase Auth login email AND the profile are changed.
// Built-in admin: only the profile email (used for Forgot Password) is changed, so
// the fixed admin login identity keeps working.
async function changeEmail(idToken, kind, id, newEmail) {
  const ctx = init();
  const bad = (msg, status) => ({ status: status || 400, body: { ok: false, error: msg } });
  if (!isEmail(newEmail) || newEmail.endsWith('@fitcoregym.local')) return bad('Please enter a valid, real email address.');
  if (kind !== 'members' && kind !== 'users') return bad('Invalid request.');
  let decoded;
  try { decoded = await ctx.auth.verifyIdToken(String(idToken || ''), true); } catch (e) { return bad('Session expired. Please log in again.', 401); }
  const ref = ctx.db.collection(kind).doc(String(id || ''));
  const snap = await ref.get();
  if (!snap.exists) return bad('Profile not found.', 404);
  const prof = snap.data();
  const tokenEmail = String(decoded.email || '').toLowerCase();
  const own = [prof.authEmail, prof.email].filter(Boolean).map((x) => String(x).toLowerCase());
  if (!tokenEmail || !own.includes(tokenEmail)) return bad('You can only change your own email.', 403);
  const isAdmin = kind === 'users' && prof.role === 'admin';
  const oldAuthEmail = tokenEmail;
  // Not used by anyone else (profiles).
  for (const col of ['members', 'users']) {
    for (const field of ['email', 'authEmail']) {
      const q = await ctx.db.collection(col).where(field, '==', newEmail).limit(3).get();
      if (q.docs.some((d) => !(col === kind && d.id === ref.id))) return bad('That email is already used by another account.', 409);
    }
  }
  if (isAdmin) {
    await ref.update({ email: newEmail });
    return { status: 200, body: { ok: true, authChanged: false } };
  }
  try {
    await ctx.auth.updateUser(decoded.uid, { email: newEmail, emailVerified: false });
  } catch (e) {
    if (e && e.code === 'auth/email-already-exists') return bad('That email is already used by another account.', 409);
    throw e;
  }
  try {
    await ref.update({ email: newEmail, authEmail: newEmail });
  } catch (e) {
    try { await ctx.auth.updateUser(decoded.uid, { email: oldAuthEmail }); } catch (e2) { /* best effort */ }
    throw e;
  }
  try { await ctx.auth.revokeRefreshTokens(decoded.uid); } catch (e) { /* non-fatal */ }
  return { status: 200, body: { ok: true, authChanged: true } };
}

// Admin edits ANOTHER user's email (trainer / staff / admin profile).
// Caller is verified by their Firebase ID token AND must have an active admin profile.
// Trainer/staff: the Firebase Auth login email AND the profile are changed in place
// (same uid, so no orphaned account). Admin target: only the profile email (used for
// Forgot Password) changes, so the fixed admin login identity keeps working.
async function adminChangeUserEmail(idToken, targetId, newEmail) {
  const ctx = init();
  const bad = (msg, status) => ({ status: status || 400, body: { ok: false, error: msg } });
  if (!isEmail(newEmail) || newEmail.endsWith('@fitcoregym.local')) return bad('Please enter a valid, real email address.');
  let decoded;
  try { decoded = await ctx.auth.verifyIdToken(String(idToken || ''), true); } catch (e) { return bad('Session expired. Please log in again.', 401); }
  const callerEmail = String(decoded.email || '').toLowerCase();
  if (!callerEmail) return bad('Session expired. Please log in again.', 401);
  const cq = await ctx.db.collection('users').where('authEmail', '==', callerEmail).limit(1).get();
  const caller = cq.empty ? null : cq.docs[0].data();
  if (!caller || caller.role !== 'admin' || caller.status === 'locked') return bad('Only an administrator can change another user\'s email.', 403);

  const ref = ctx.db.collection('users').doc(String(targetId || ''));
  const snap = await ref.get();
  if (!snap.exists) return bad('Profile not found.', 404);
  const prof = snap.data();
  if (prof.role !== 'admin' && prof.role !== 'staff' && prof.role !== 'trainer') return bad('Invalid request.');

  for (const col of ['members', 'users']) {
    for (const field of ['email', 'authEmail']) {
      const q = await ctx.db.collection(col).where(field, '==', newEmail).limit(3).get();
      if (q.docs.some((d) => !(col === 'users' && d.id === ref.id))) return bad('That email is already used by another account.', 409);
    }
  }
  if (prof.role === 'admin') {
    await ref.update({ email: newEmail });
    return { status: 200, body: { ok: true, authChanged: false } };
  }
  const oldAuthEmail = String(prof.authEmail || '').toLowerCase();
  if (!oldAuthEmail) return bad('This account has no login on file. Re-create the user.', 409);
  let uid;
  try { uid = (await ctx.auth.getUserByEmail(oldAuthEmail)).uid; } catch (e) { return bad('Login account for this user was not found.', 404); }
  try {
    await ctx.auth.updateUser(uid, { email: newEmail, emailVerified: false });
  } catch (e) {
    if (e && e.code === 'auth/email-already-exists') return bad('That email is already used by another account.', 409);
    throw e;
  }
  try {
    await ref.update({ email: newEmail, authEmail: newEmail });
  } catch (e) {
    try { await ctx.auth.updateUser(uid, { email: oldAuthEmail }); } catch (e2) { /* best effort */ }
    throw e;
  }
  try { await ctx.auth.revokeRefreshTokens(uid); } catch (e) { /* non-fatal */ }
  return { status: 200, body: { ok: true, authChanged: true } };
}

// Admin issues a ONE-TIME CODE for a member who cannot use their email (lost access,
// forgot the Gmail password, etc.). The code is generated, hashed and stored HERE using
// the same record the email flow uses, so the member finishes through the normal
// Forgot Password screen (email + code -> new password). Nothing is emailed; the code is
// returned once to the verified admin, who gives it to the member in person.
const ADMIN_CODE_TTL_MS = 15 * 60 * 1000;   // admin-issued code valid 15 minutes
async function adminIssueResetCode(idToken, memberId) {
  const ctx = init();
  const bad = (msg, status) => ({ status: status || 400, body: { ok: false, error: msg } });
  let decoded;
  try { decoded = await ctx.auth.verifyIdToken(String(idToken || ''), true); } catch (e) { return bad('Session expired. Please log in again.', 401); }
  const callerEmail = String(decoded.email || '').toLowerCase();
  if (!callerEmail) return bad('Session expired. Please log in again.', 401);
  const cq = await ctx.db.collection('users').where('authEmail', '==', callerEmail).limit(1).get();
  const caller = cq.empty ? null : cq.docs[0].data();
  if (!caller || caller.role !== 'admin' || caller.status === 'locked') return bad('Only an administrator can issue a reset code.', 403);

  const ref = ctx.db.collection('members').doc(String(memberId || ''));
  const snap = await ref.get();
  if (!snap.exists) return bad('Member not found.', 404);
  const prof = snap.data();
  const email = [prof.authEmail, prof.email].map((x) => String(x || '').trim().toLowerCase())
    .find((x) => x && isEmail(x) && !x.endsWith('@fitcoregym.local'));
  if (!email) return bad('This member has no real email on file. Add one in Edit Profile first.', 409);

  const target = await resolveTarget(email, ctx);
  if (!target || !target.profile || target.profile.kind !== 'members' || target.profile.id !== ref.id) {
    return bad('Could not find this member\'s login account.', 404);
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  await ctx.db.collection(COLLECTION).doc(sha256(email)).set({
    codeHash: hmac(email + ':' + code), codeExp: now + ADMIN_CODE_TTL_MS, attempts: 0,
    lastSentAt: now, uid: target.uid, authEmail: target.authEmail,
    profile: target.profile, resetHash: null, resetExp: 0,
    adminIssued: true, issuedBy: callerEmail
  });
  return { status: 200, body: { ok: true, code, email, expiresInMin: ADMIN_CODE_TTL_MS / 60000 } };
}

// Admin sets a member's password directly (Edit Member -> Password). Verified by the admin's Firebase ID token.
async function adminSetMemberPassword(idToken, memberId, email, newPassword) {
  const ctx = init();
  const bad = (msg, status) => ({ status: status || 400, body: { ok: false, error: msg } });
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) return bad('Password must be at least 8 characters.');
  let decoded;
  try { decoded = await ctx.auth.verifyIdToken(String(idToken || ''), true); } catch (e) { return bad('Session expired. Please log in again.', 401); }
  const callerEmail = String(decoded.email || '').toLowerCase();
  if (!callerEmail) return bad('Session expired. Please log in again.', 401);
  const cq = await ctx.db.collection('users').where('authEmail', '==', callerEmail).limit(1).get();
  const caller = cq.empty ? null : cq.docs[0].data();
  if (!caller || caller.role !== 'admin' || caller.status === 'locked') return bad('Only an administrator can reset a member password.', 403);

  const ref = ctx.db.collection('members').doc(String(memberId || ''));
  const snap = await ref.get();
  if (!snap.exists) return bad('Member not found.', 404);
  const prof = snap.data();
  const loginEmail = [prof.authEmail, prof.email].map((x) => String(x || '').trim().toLowerCase()).find((x) => x && isEmail(x));
  if (!loginEmail) return bad('This member has no login account yet.', 409);
  const target = await resolveTarget(loginEmail, ctx);
  if (!target || !target.profile || target.profile.kind !== 'members' || target.profile.id !== ref.id) {
    return bad('Could not find this member\'s login account.', 404);
  }
  await ctx.auth.updateUser(target.uid, { password: newPassword });
  await ctx.auth.revokeRefreshTokens(target.uid);
  try { await ref.update({ mustChangePassword: false }); } catch (e) { /* non-fatal */ }
  try { await ctx.db.collection(COLLECTION).doc(sha256(loginEmail)).delete(); } catch (e) { /* no pending code */ }
  return { status: 200, body: { ok: true } };
}

module.exports = { sendCode, verifyCode, resetPassword, changeEmail, adminChangeUserEmail, adminIssueResetCode, adminSetMemberPassword, isEmail, init };
