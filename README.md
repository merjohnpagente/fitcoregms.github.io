#FITCORE GYM MANAGEMENT SYSTEM 
#SOFTWARE ENGINEER PROJECT

## WorkoutX exercise animations

The Exercise Library ships with 50 WorkoutX exercises in `workoutx-exercises.js` (metadata only). Fresh poster/MP4 links are served by the Vercel function at `/api/exercises`; the API key never reaches the browser.

- In Vercel, add `WX_API_KEY` under Project Settings -> Environment Variables, then redeploy. Keep `api/` at the Vercel project root (next to `index.html`) so it is exposed as `/api/exercises`.
- To refresh the local metadata file: copy `.env.example` to `.env`, set the key, then run `node --env-file=.env scripts/sync-workoutx.cjs`.
- If the static site and the Vercel function are on different origins, set `window.WORKOUTX_API_BASE` in `index.html` before `script.js` (for example, your Vercel project URL).