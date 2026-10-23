const { fetchWorkoutXExercises } = require('../server/workoutx');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  // The exercise data is public; the WorkoutX key stays server-side.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    send(res, 405, { error: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.WX_API_KEY;
  if (!apiKey) {
    res.setHeader('Cache-Control', 'no-store');
    send(res, 503, { error: 'WorkoutX API key is not configured on the server.' });
    return;
  }

  try {
    const exercises = await fetchWorkoutXExercises(apiKey);
    // Signed media links expire after 24-25 hours; refresh with a margin.
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=79200, stale-while-revalidate=3600');
    send(res, 200, {
      source: 'workoutx',
      count: exercises.length,
      generatedAt: new Date().toISOString(),
      exercises
    });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    send(res, 502, {
      error: 'WorkoutX request failed.',
      message: String(error && error.message || error).slice(0, 240)
    });
  }
};
