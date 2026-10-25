#FITCORE GYM MANAGEMENT SYSTEM 
#SOFTWARE ENGINEER PROJECT

## WorkoutX exercise animations

The Exercise Library ships with 50 WorkoutX exercises in `workoutx-exercises.js` (metadata only). Fresh poster/MP4 links are served by the Vercel function at `/api/exercises`; the API key never reaches the browser.

- In Vercel, add `WX_API_KEY` under Project Settings -> Environment Variables, then redeploy. Keep `api/` at the Vercel project root (next to `index.html`) so it is exposed as `/api/exercises`.
- To refresh the local metadata file: copy `.env.example` to `.env`, set the key, then run `node --env-file=.env scripts/sync-workoutx.cjs`.
- If the static site and the Vercel function are on different origins, set `window.WORKOUTX_API_BASE` in `index.html` before `script.js` (for example, your Vercel project URL).

## Starter exercise demos

The 12 built-in starter exercises have no match in the WorkoutX 50. Their local animated demos live in `assets/exercise-demos/` and are sourced from the `hasaneyldrm/exercises-dataset` project (media © Gym visual, https://gymvisual.com/). They are included for this project's demo; review Gym Visual's media terms before commercial redistribution.

## Data storage and Activity Log

- All business collections are stored in Firestore. `localStorage` is only a cache/offline fallback; failed cloud writes are retried when the device reconnects or a user signs in.
- The Activity Log is internal-only (admin and staff; trainers cannot see it). Member actions are excluded from every view and rejected by `docs/firestore.rules`. Publish the updated rules in Firebase Console after pulling changes.

## Flutter mobile app

The Android app lives in `mobile/` and is built by GitHub Actions (`.github/workflows/mobile-ci.yml`). See `mobile/README.md` for Firebase setup, local builds and release signing.

- Every push that changes `mobile/` builds a debug APK artifact.
- Tags matching `mobile-v*` build a signed release APK and publish a GitHub Release.
- Before shipping, register the Android package `io.github.merjohnpagente.fitcoregms` in the Firebase console and add `mobile/android/app/google-services.json`.
