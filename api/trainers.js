'use strict';
// Public trainer profiles for the landing page. Guests cannot read the
// `users` collection (Firestore rules require auth), which left the public
// "Meet Our Trainers" section empty unless an admin was logged in.
const { init } = require('../server/passwordReset');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
  res.end(JSON.stringify(payload));
}

// Only fields that are meant to be public — never email, contact or username.
function publicTrainer(id, d) {
  const arr = (v) => (Array.isArray(v) ? v.map(String) : (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));
  return {
    id,
    name: String(d.name || d.coachName || 'Trainer'),
    coachName: String(d.coachName || ''),
    specializations: arr(d.specializations),
    availableDays: arr(d.availableDays),
    availableFrom: String(d.availableFrom || ''),
    availableTo: String(d.availableTo || ''),
    bio: String(d.bio || '')
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method not allowed.' });

  try {
    const ctx = init();
    const snap = await ctx.db.collection('users').where('role', '==', 'trainer').get();
    const trainers = [];
    snap.forEach((doc) => {
      const d = doc.data() || {};
      if (d.status === 'active') trainers.push(publicTrainer(doc.id, d));
    });
    trainers.sort((a, b) => String(a.coachName || a.name).localeCompare(String(b.coachName || b.name)));
    return send(res, 200, { ok: true, trainers });
  } catch (e) {
    console.error('[trainers]', e && e.message);
    return send(res, 500, { ok: false, error: 'Could not load trainers.' });
  }
};
