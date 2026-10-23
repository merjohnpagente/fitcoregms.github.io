// Shared WorkoutX v2 fetch/normalize logic.
// The API key is only read by the Vercel function and the local sync script.
const WX_BASE = 'https://api.workoutxapp.com/v2';

// Free plan: 10 results per request and one filter at a time.
// These quotas give us 50 balanced exercises from 7 requests.
const SOURCES = [
  { bodyPart: 'chest', quota: 8 },
  { bodyPart: 'back', quota: 8 },
  { bodyPart: 'upper legs', quota: 8 },
  { bodyPart: 'shoulders', quota: 8 },
  { bodyPart: 'upper arms', quota: 8 },
  { bodyPart: 'waist', quota: 8 },
  { bodyPart: 'cardio', quota: 2 }
];

const MUSCLE_MAP = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  neck: 'Shoulders',
  'upper legs': 'Legs',
  'lower legs': 'Legs',
  'upper arms': 'Arms',
  'lower arms': 'Arms',
  waist: 'Core',
  cardio: 'Cardio'
};

const EQUIPMENT_MAP = {
  'Body Weight': 'Bodyweight',
  'Leverage Machine': 'Machine',
  'Olympic Barbell': 'Barbell',
  'EZ Barbell': 'EZ Bar',
  'Suspension Trainer': 'Suspension',
  'Stationary Bike': 'Machine',
  'Rowing Machine': 'Machine',
  'Elliptical Trainer': 'Machine',
  'Step Mill': 'Machine',
  'Upper Body Ergometer': 'Machine',
  'Indoor Bike': 'Machine',
  'Skierg': 'Machine'
};

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function truncate(value, max) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return text.slice(0, max - 3).replace(/\s+\S*$/, '') + '...';
}

function capitalize(value) {
  const text = cleanText(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
}

function nameKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeExercise(exercise, fallbackBodyPart) {
  const bodyPart = cleanText(exercise.bodyPart || fallbackBodyPart).toLowerCase();
  const instructions = Array.isArray(exercise.instructions)
    ? exercise.instructions.map(cleanText).filter(Boolean)
    : [];
  const tips = Array.isArray(exercise.tips)
    ? exercise.tips.map(cleanText).filter(Boolean)
    : [];
  const media = exercise.media && exercise.media.mp4
    ? {
        mp4: exercise.media.mp4,
        poster: exercise.media.poster || '',
        expiresAt: exercise.media.expiresAt || '',
        watermarked: !!exercise.media.watermarked
      }
    : null;

  return {
    id: 'wx_' + exercise.id,
    apiId: exercise.id,
    name: cleanText(exercise.name),
    muscle: MUSCLE_MAP[bodyPart] || capitalize(bodyPart) || 'Other',
    equipment: EQUIPMENT_MAP[exercise.equipment] || cleanText(exercise.equipment) || 'Bodyweight',
    level: capitalize(exercise.difficulty) || 'Intermediate',
    desc: truncate(tips[0] || instructions[0] || `${cleanText(exercise.target)} ${cleanText(exercise.equipment)}`.trim(), 180) || 'WorkoutX exercise.',
    target: cleanText(exercise.target),
    bodyPart: cleanText(exercise.bodyPart || fallbackBodyPart),
    instructions,
    tips,
    recommendedSets: cleanText(exercise.recommendedSets),
    recommendedReps: cleanText(exercise.recommendedReps),
    model: cleanText(exercise.model) || 'male',
    source: 'workoutx',
    media
  };
}

async function fetchPart(source, apiKey) {
  // Do not add model=... here: the free plan allows only one filter per request.
  const url = `${WX_BASE}/exercises?bodyPart=${encodeURIComponent(source.bodyPart)}&limit=10&offset=0`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: {
        'X-WorkoutX-Key': apiKey,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`WorkoutX ${source.bodyPart} returned ${response.status}${detail ? ' ' + detail.slice(0, 120) : ''}`);
    }
    const payload = await response.json();
    return (Array.isArray(payload.results) ? payload.results : [])
      .map(exercise => normalizeExercise(exercise, source.bodyPart))
      .filter(exercise => exercise.apiId && exercise.name);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWorkoutXExercises(apiKey) {
  if (!apiKey) throw new Error('WX_API_KEY is not configured.');

  const settled = await Promise.allSettled(SOURCES.map(source => fetchPart(source, apiKey)));
  const groups = {};
  const errors = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      groups[SOURCES[index].bodyPart] = result.value;
    } else {
      errors.push(String(result.reason && result.reason.message || result.reason));
    }
  });

  const all = [];
  const seenIds = new Set();
  const seenNames = new Set();
  Object.keys(groups).forEach(bodyPart => {
    groups[bodyPart].forEach(exercise => {
      const key = nameKey(exercise.name);
      if (seenIds.has(exercise.apiId) || seenNames.has(key)) return;
      seenIds.add(exercise.apiId);
      seenNames.add(key);
      all.push(exercise);
    });
  });

  if (!all.length) throw new Error(errors[0] || 'WorkoutX returned no exercises.');

  const selected = [];
  const selectedIds = new Set();
  const selectedNames = new Set();

  SOURCES.forEach(source => {
    let taken = 0;
    (groups[source.bodyPart] || []).forEach(exercise => {
      const key = nameKey(exercise.name);
      if (taken >= source.quota || selectedIds.has(exercise.apiId) || selectedNames.has(key)) return;
      selected.push(exercise);
      selectedIds.add(exercise.apiId);
      selectedNames.add(key);
      taken++;
    });
  });

  // If a category came back short, fill the gap from the remaining unique results.
  if (selected.length < 50) {
    all.forEach(exercise => {
      const key = nameKey(exercise.name);
      if (selected.length >= 50 || selectedIds.has(exercise.apiId) || selectedNames.has(key)) return;
      selected.push(exercise);
      selectedIds.add(exercise.apiId);
      selectedNames.add(key);
    });
  }

  return selected.slice(0, 50);
}

module.exports = { fetchWorkoutXExercises, SOURCES };
