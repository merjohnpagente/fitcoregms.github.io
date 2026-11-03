'use strict';
// ============================================================
// FitCore GMS - GCash payment proof (server-side)
// Expired members have no signed-in Firebase session, and their
// password may live only in the app's legacy hash (admin reset /
// temp password), so the browser cannot write the proof itself.
// The server validates the member + reference and writes the
// notification doc that admin/staff verify in Billing.
// ============================================================
const crypto = require('crypto');
const { init } = require('./passwordReset');

const MAX_RECEIPT_CHARS = 400000; // compressed client-side (~260k) + base64 overhead
const normRef = (v) => String(v || '').replace(/[\s-]+/g, '').toUpperCase();
const bad = (msg, status) => ({ status: status || 400, body: { ok: false, error: msg } });

// Walk-in visitors have no member record: the fee and time limit come from
// the admin's settings/walkin doc, never from the browser.
async function submitWalkinProof(body) {
  const name = String(body.visitorName || '').replace(/[<>]/g, '').trim().slice(0, 60);
  const reference = normRef(body.reference);
  const receipt = String(body.receipt || '');
  if (name.length < 2) return bad('Please enter your full name.');
  if (!/^[A-Z0-9]{8,24}$/.test(reference)) return bad('Enter a valid GCash reference number (letters/numbers, at least 8 characters).');
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(receipt) || receipt.length > MAX_RECEIPT_CHARS) {
    return bad('Please upload a screenshot of your GCash receipt (JPG or PNG).');
  }
  const ctx = init();
  const ws = await ctx.db.collection('settings').doc('walkin').get();
  const w = ws.exists ? (ws.data() || {}) : {};
  const fee = Number(w.fee) > 0 ? Number(w.fee) : 100;
  const hours = Number(w.hours) > 0 && Number(w.hours) <= 12 ? Number(w.hours) : 2;

  const sameRef = await ctx.db.collection('notifications').where('reference', '==', reference).limit(10).get();
  let used = false;
  sameRef.forEach((doc) => {
    const x = doc.data() || {};
    if ((x.type === 'gcash_proof' || x.type === 'walkin_proof') && x.status !== 'rejected') used = true;
  });
  if (!used) {
    const paid = await ctx.db.collection('payments').where('reference', '==', reference).limit(5).get();
    paid.forEach(() => { used = true; });
  }
  if (used) return bad('This reference number was already used.');

  const id = 'WIP-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
  await ctx.db.collection('notifications').doc(id).set({
    id,
    type: 'walkin_proof',
    status: 'open',
    visitorName: name,
    hours,
    amount: fee,
    reference,
    receipt,
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    source: 'online-walkin'
  });
  return { status: 200, body: { ok: true, id } };
}

async function submitGcashProof(body) {
  if (body && body.type === 'walkin') return submitWalkinProof(body);
  const memberId = String(body.memberId || '').trim().slice(0, 80);
  const reference = normRef(body.reference);
  const receipt = String(body.receipt || '');
  if (!memberId) return bad('Session expired. Please log in again and retry.');
  if (!/^[A-Z0-9]{8,24}$/.test(reference)) return bad('Enter a valid GCash reference number (letters/numbers, at least 8 characters).');
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(receipt) || receipt.length > MAX_RECEIPT_CHARS) {
    return bad('Please upload a screenshot of your GCash receipt (JPG or PNG).');
  }

  const ctx = init();
  const memberSnap = await ctx.db.collection('members').doc(memberId).get();
  if (!memberSnap.exists) return bad('Member account not found. Please contact the front desk.', 404);
  const member = memberSnap.data() || {};
  if (member.status === 'Archived') return bad('Member account not found. Please contact the front desk.', 404);

  const planSnap = member.planId ? await ctx.db.collection('plans').doc(String(member.planId)).get() : null;
  const plan = planSnap && planSnap.exists ? planSnap.data() : null;
  if (!plan) return bad('No plan on file. Please visit the front desk to renew.', 409);

  // One open proof per member - same rule the member UI shows.
  const mine = await ctx.db.collection('notifications').where('memberId', '==', memberId).limit(50).get();
  let open = false;
  mine.forEach((doc) => {
    const x = doc.data() || {};
    if (x.type === 'gcash_proof' && x.status === 'open') open = true;
  });
  if (open) return bad('You already submitted a payment that is waiting for verification.');

  // A reference number can only back one payment.
  const sameRef = await ctx.db.collection('notifications').where('reference', '==', reference).limit(10).get();
  let used = false;
  sameRef.forEach((doc) => {
    const x = doc.data() || {};
    if (x.type === 'gcash_proof' && x.status !== 'rejected') used = true;
  });
  if (!used) {
    const paid = await ctx.db.collection('payments').where('reference', '==', reference).limit(5).get();
    paid.forEach(() => { used = true; });
  }
  if (used) return bad('This reference number was already used.');

  // Extra trainer sessions: price comes from settings, never from the browser.
  let addon = null;
  if (body.kind === 'sessions_addon') {
    const qty = Math.floor(Number(body.qty));
    if (!(qty >= 1 && qty <= 20)) return bad('Choose between 1 and 20 sessions.');
    if (member.status !== 'Active' && member.status !== 'Expiring Soon') return bad('Your membership must be active to add sessions.', 409);
    if (!plan || String(plan.sessions) === 'Unlimited' || !(Number(plan.sessions) > 0)) return bad('Your plan does not use trainer sessions.', 409);
    if (qty > Number(plan.sessions)) return bad('You can add at most ' + Number(plan.sessions) + ' sessions at a time for your plan.');
    const ss = await ctx.db.collection('settings').doc('sessions').get();
    const price = ss.exists && Number((ss.data() || {}).price) > 0 ? Number(ss.data().price) : 150;
    addon = { qty, amount: qty * price };
  }

  const id = 'GCP-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
  const proof = {
    id,
    type: 'gcash_proof',
    status: 'open',
    memberId,
    memberName: String(member.name || ''),
    planId: String(member.planId || ''),
    planName: addon ? 'Session Add-on (' + addon.qty + ' session' + (addon.qty !== 1 ? 's' : '') + ')' : String(plan.name || ''),
    amount: addon ? addon.amount : (Number(plan.price) || 0),
    reference,
    receipt,
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    source: 'online-renewal'
  };
  if (addon) { proof.kind = 'sessions_addon'; proof.sessions = addon.qty; }
  await ctx.db.collection('notifications').doc(id).set(proof);
  return { status: 200, body: { ok: true, id } };
}

module.exports = { submitGcashProof };
