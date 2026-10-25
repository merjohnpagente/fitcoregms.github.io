# FitCore GMS — Flutter mobile app

Android-first Flutter client for the FitCore gym management system. It talks to the
same Firebase project (`fitcoregym-1019f`) and Firestore collections as the web app.

## What is in this build (M1)

- Firebase Auth login with the same username/email → `authEmail` lookup as the web app
- Pending/locked account gate
- Role routing for member, trainer, staff and admin (auto-detected from the Firestore profile)
- Role dashboards, profile, sign-out
  - **Admin**: dashboard, members, billing, scanner, users, plans, reports, activity log
  - **Staff**: dashboard, members, billing, scanner, queue, walk-ins, schedule, renewals
  - **Trainer**: dashboard, schedule, assigned sessions, exercise library, profile
  - **Member**: dashboard, QR, attendance, sessions, profile
- Placeholder screens for the core modules that land in M2–M4
- GitHub Actions: debug APK on changes under `mobile/`, signed release APK on `mobile-v*` tags

## Firebase setup (required for a working login)

1. Open the Firebase console for project `fitcoregym-1019f`.
2. Add an Android app with package name `io.github.merjohnpagente.fitcoregms`.
3. Download `google-services.json` and save it to `mobile/android/app/google-services.json`.
4. Rebuild. The Gradle plugin is applied automatically when the file exists.

Until that file exists, the app falls back to the public web Firebase options so CI and
debug builds still boot. Register the Android app before shipping or collecting real data.

## Local build

```bash
cd mobile
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

APK output: `mobile/build/app/outputs/flutter-apk/app-debug.apk`.

## Release signing

Tag builds read four repository secrets:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | base64 of the release `.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Create and push a tag to publish:

```bash
git tag mobile-v0.1.0
git push origin mobile-v0.1.0
```

## Roadmap

- **M1**: auth, roles, dashboards, CI (this build)
- **M2**: members, billing, renewals, receipts
- **M3**: QR attendance, scanner, schedule and sessions
- **M4**: admin users/plans/reports/activity log, trainer tools
- **M5**: tests, compatibility audit, signed release
