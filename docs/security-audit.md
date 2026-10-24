# FitCore GMS — Security Audit (client + Firebase)

Date: 2026-10-24
Scope: static review of `script.js`, `db-firebase.js`, `index.html`, and the
current Firestore rules. No browser/runtime access was available; findings were
verified with `node --check` plus an assert harness for session availability.

## Fixed in this pass

1. **Password material no longer syncs to Firestore.**
   `GMSFB._clean()` deletes `password` and `passwordHash`. `scrubSensitiveFields()`
   removes legacy hashes from existing docs after an admin signs in.
2. **Privileged accounts use Firebase Auth, not client hashes.**
   Admin/staff/trainer login no longer accepts a password-hash fallback. Password
   changes send a Firebase Auth reset link; `confirmForgotPassword()` rejects
   `targetType==='user'` (legacy/forged verifier state).
3. **Sessions are tied to the signed-in Firebase Auth identity.**
   A restored tab session is validated against the current Auth email before the
   app loads, so a copied `sessionStorage` record alone is not enough.
4. **Spam/abuse limits.**
   Signup: 30 s cooldown + 5 per 10 min. Messages: 1 000 chars, 1 per 2 s and
   20 per 10 min. Bookings: max 3 per day, 1 per 10 s and 5 per 10 min.
   Announcements: title 120 / text 2 000 chars. Forgot Password: 3 requests per
   15 min with a generic response (no account enumeration).
5. **EmailJS removed from the page.**
   Forgot Password is now a server-side Firebase reset email; the old OTP UI is
   unreachable. No EmailJS script/config is loaded.
6. **Real Gmail identities for staff/trainer/admin.**
   New accounts require a real email and use it as `authEmail`. Duplicate emails
   across users and members are blocked in the form and again on save. Existing
   synthetic-email trainers can be migrated by editing them with a Gmail plus a
   temporary password.
7. **Admin member edit no longer creates or edits a member login.**
   The username/password fields were removed. The edit form records and shows the
   Gmail the member used at registration (`email`, falling back to a real
   `authEmail`), and blocks a Gmail already used by another member or staff user.
8. **Background-check gate.**
   `Flagged` blocks check-in and activation; `Pending` does not block; `Cleared`
   passes.
9. **Booking conflict controls.**
   Member/admin/staff trainer lists show only trainers who offer the selected
   session type and are free for the chosen date/time. The same
   `isTrainerAvailable()` predicate guards booking saves and admin edits.
   Accepting a pending session and toggling a session back to `Scheduled` also
   reject trainer/member overlaps.

## Residual risks / open items

- **Firestore rules are still permissive.** `docs/firestore.rules` has not been
  published. Until the v3 role-based rules are live, a signed-in client can write
  beyond the UI. This is the largest remaining gap.
- **Client-side conflict checks are not atomic.** Two devices can submit the same
  trainer slot before either write is visible. The current fix prevents conflicts
  on synced data and on normal sequential use; strict enforcement needs a
  Firestore transaction or rules-level slot check.
- **Public member reads and the static QR secret.** Member documents (including
  contact and QR data) are readable to signed-in clients; the QR signing secret is
  in client code. Fixing this needs a login index/role-based read model and a
  server-side QR signer.
- **Firebase Web API key is public by design.** Restrict it to the production
  domains and enabled Auth providers in Google Cloud Console.
- **Rotate the previously exposed WorkoutX key.** The client copies were removed,
  but the old key should be revoked/rotated.
- **Legacy synthetic-email accounts** cannot receive a reset link until migrated.
  A bulk migration needs Firebase Admin SDK/service-account credentials.
- **Member forced-password-change fallback** still writes a local hash (never
  synced). This is retained for offline/legacy members only; privileged accounts
  are not covered by it.
- **Street address select** has no PSGC street dataset; it remains a text input.
- **Past-time bookings on today's date** are not blocked (past dates are). The
  trainer can still decline.
- **WorkoutX watermark** on free-tier media cannot be removed without paid or
  self-hosted media.

## Firebase Console checklist

1. Publish `docs/firestore.rules` only after the v3 role rules are reviewed.
2. Authentication → Sign-in method: Email/Password enabled; authorized domains
   include `merjohnpagente.github.io`.
3. Google Cloud Console → API key restrictions: HTTP referrers for the production
   domain; restrict to Firebase APIs.
4. Rotate the WorkoutX API key and update the server environment variable.
5. Review Authentication → Users for orphan accounts from earlier failed trainer
   adds. Either delete them or re-add the trainer with the same Gmail and password
   (the form now recovers and attaches the profile).
6. Optionally enable Firebase App Check before opening registration publicly.

## v3 rules plan (draft, not published)

- `users`: read for authenticated staff/admin; create only through the registration
  flow; update self-profile fields or admin-managed fields by role; never accept
  `password`/`passwordHash`.
- `members`: read by the member themselves, assigned trainer, staff, admin; create
  by self-registration; update by admin or limited self fields (`avatar`, contact,
  address); no client-side `status`/`planId` changes by members.
- `payments`, `activitylog`, `announcements`: admin/staff write, role-scoped read.
- `sessions`: create/update by member (own Pending), trainer (own status changes),
  admin/staff; validate trainer belongs to the selected session type and no
  overlapping `Scheduled`/`Pending` record remains.
- `settings`/`exerciseLibrary`: read-mostly; admin-only writes.

The rules file in `docs/firestore.rules` is a starting point; publish only after the
above is implemented and tested in a staging project.
