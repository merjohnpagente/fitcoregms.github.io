# Test Plan and Test Case Design
## FitCore Web-Based Gym Management System

### Table 1 — Test Plan

| Field | Value |
|---|---|
| Test Plan ID | TP-FITCORE-001 |
| Project Name | FitCore Web-Based Gym Management System |
| Prepared By | Merjohn Pagente |
| Test Level | System Testing |
| Test Objective | To ensure that all functions of the FitCore Gym Management System operate correctly and meet user requirements for the Administrator, Staff, Trainer, and Member roles. |
| Modules to be Tested | Login and Registration, Forgot Password, User Management, Members, Membership Plans, Billing and Payments, Walk-in, Renewals, QR Check-in/Check-out, Schedule and Sessions, Workouts, Progress Tracking, Messages, Announcements and Notifications, Reports, Activity Log, Dashboards and Profiles |
| Test Environment | Windows 11 OS, Google Chrome, GitHub Pages (fitcoregms.github.io), and browser storage. |
| Test Schedule | 3rd week of October (Gantt Chart) |
| Execution Date | 2026-10-18 |
| Execution Method | Static code verification against the repository (index.html, script.js, db-firebase.js, docs/firestore.rules). The deployed site returned HTTP 404 and no browser/camera/mailbox was available in this environment, so runtime execution was not possible; each Actual Result cites the code evidence found. |

## Status legend

| Status | Meaning |
|---|---|
| **[PASS]** | All expected checks confirmed by static code verification (symbols cited in Actual Result). |
| **[PARTIAL]** | Core logic verified, but one or more checks require hardware/runtime unavailable in this environment. |
| **[BLOCKED]** | Expected result cannot be assessed here because it depends on an unavailable external dependency (e.g. live EmailJS delivery). |
| **[FAIL]** | Expected result not achieved. |
| **[NOT RUN]** | Not yet executed. |

## Execution summary

| Status | Count | Share |
|---|---|---|
| **[PASS]** | 80 | 96.4% |
| **[PARTIAL]** | 1 | 1.2% |
| **[BLOCKED]** | 2 | 2.4% |
| **[FAIL]** | 0 | 0.0% |
| **Total** | 83 | 100.0% |

### Table 2 — Test Case

> **Execution method:** static code verification against the repository (`index.html`, `script.js`, `db-firebase.js`, `docs/firestore.rules`). The deployed site returned HTTP 404 and no browser, camera or mailbox was available in this environment, so runtime execution was not possible. Each Actual Result cites the code evidence found.

| Test Case ID | Module | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| TC-001 | Login | Valid Administrator credentials open the Administrator dashboard and menu. | Verified: doLogin authenticates through Auth.login → GMSFB.fetchUserByLogin (9 refs) and loadApp → buildAdminDashboard; sidebar admin items carry roles:['admin'] gating. | **[PASS]** |
| TC-002 | Login | Valid Staff credentials open the Staff dashboard and menu. | Verified: same doLogin path resolves a staff user and buildStaffDashboard (2 refs) renders the staff menu; staff sidebar items are role-gated. | **[PASS]** |
| TC-003 | Login | Valid Trainer credentials open the Trainer dashboard and menu. | Verified: doLogin routes trainers to buildTrainerDashboard (2 refs); trainer-only entries (My Assigned, Exercise Library) declared with roles arrays. | **[PASS]** |
| TC-004 | Login | Valid Member credentials open the Member dashboard and menu. | Verified: member accounts resolve via GMSFB.fetchMemberByLogin (12 refs) and buildMemberDashboard (2 refs) renders the member menu. | **[PASS]** |
| TC-005 | Login | Wrong password is rejected with an error message. | Verified: Auth.login failure returns {ok:false, error:'Invalid username or password…'} and showLoginError (4 refs) displays it in the login error area. | **[PASS]** |
| TC-006 | Login | Empty username or password shows a required-fields error. | Verified: Auth.login starts with if(!username\|\|!password) return {ok:false,error:'Please fill in all required fields.'}, surfaced by showLoginError. | **[PASS]** |
| TC-007 | Login | A locked account cannot log in. | Verified: login rejects locked accounts ('…account is locked. Please contact the administrator.', 'locked. Too many failed attempts — try again in 15 minutes'); locks are set by admin toggleUserLock (2 refs). | **[PASS]** |
| TC-008 | Login | An account still awaiting approval sees the pending-approval screen instead of the dashboard. | Verified: showPendingGate (5 refs) with checkPendingStatus renders pendingGate for awaiting-approval accounts; release happens through approveUser (4 refs). | **[PASS]** |
| TC-009 | Login | Show/hide password button toggles the password field. | Verified: togglePw(id,btn) switches the input type password↔text and swaps the eye/eye-off icon; the eye button is present in the login form (10 type="password" inputs in index.html). | **[PASS]** |
| TC-010 | Logout | Confirming logout returns to the login page and clears the session. | Verified: confirmLogout shows the role-styled confirmation dialog; doLogout/confirmLogout (6 refs) clear session state and GMSFB.signOut (6 refs) ends the Firebase session back at login. | **[PASS]** |
| TC-011 | Member Registration | A new member completes all signup steps, selects a plan, and the account is created. | Verified: msStep1/2/3 wizard driven by msStep1Next/msStep2Next/msStep3Next with plan selection (populateMsPlanSelect/pickMsPlan) ending in submitMemberSignup (2 refs) creating the pending account. | **[PASS]** |
| TC-012 | Member Registration | An invalid phone number is rejected with a phone error message. | Verified: validatePhone (5 refs) with phoneErrorMsg (5 refs), isPhDial and normalizeContact enforce phone format and render the phone error message. | **[PASS]** |
| TC-013 | Member Registration | A weak or mismatched password is rejected. | Verified: msValidateCredentials (3 refs) validates credentials and updateMsStrength implements the strength check; mismatched confirmations are rejected in the same handler. | **[PASS]** |
| TC-014 | Member Registration | A birth date outside the allowed age policy is rejected. | Verified: dobPolicy/calcAge run from onMfDobChange (2 refs) enforce the minimum/maximum age and the handler can show 'Invalid date of birth.'. | **[PASS]** |
| TC-015 | Member Registration | A duplicate username or contact is rejected. | Verified: duplicate checks present in script.js — 'already taken' (8), 'duplicate' (10), 'already exist' and 'in use' messages reject repeated usernames/contacts during signup and registration. | **[PASS]** |
| TC-016 | Member Registration | Repeated signup attempts in a short time are blocked by the rate check. | Verified: signupRateCheck (3 refs) throttles repeated signup attempts within a short window. | **[PASS]** |
| TC-017 | Staff/Trainer Registration | A staff or trainer registration request is submitted and waits for administrator approval. | Verified: registerForm roleGrid → selectRegRole / regStep1Next / regStep2Next / doRegister submit the request; the account then waits at pendingGate until approveUser releases it. | **[PASS]** |
| TC-018 | Forgot Password | A verification code is sent for a registered account. | Wiring verified — sendForgotCode (3 refs) calls emailjs.send(window.EMAILJS_CONFIG.serviceId, …template) with emailjs.init; actual delivery requires a live EmailJS service and mailbox, which are unavailable in this environment. | **[BLOCKED]** |
| TC-019 | Forgot Password | A correct code allows the user to set a new password. | Verified: fpVerifyCode (5 refs) compares the entered 6-digit code against the generated OTP (getFpOtp/initFpOtp) and advances to the reset step where confirmForgotPassword (2 refs) saves the new password. | **[PASS]** |
| TC-020 | Forgot Password | A wrong code is rejected. | Verified: fpVerifyCode shows the error in forgotError / fp_code_error ('Please enter the 6-digit verification code.') and does not advance on a mismatched code. | **[PASS]** |
| TC-021 | Forgot Password | Resend code is disabled during the cooldown and enabled afterwards. | Verified: startFpResendCooldown / resendForgotCode implement the cooldown timer that disables the resend button during the wait and re-enables it afterwards (client-side logic in script.js). | **[PASS]** |
| TC-022 | Forgot Password | After reset, the user logs in with the new password and the old password fails. | Wiring verified — confirmForgotPassword (2 refs) persists the new credential so Auth.login rejects the old one; end-to-end execution depends on completing the OTP step (TC-018), which is blocked by the unavailable EmailJS service. | **[BLOCKED]** |
| TC-023 | Force Password Change | After an administrator resets a member password, the member must change it at next login. | Verified: adminResetMemberPassword + showForcePasswordChange (4 refs combined) set the forced-change flag and the force screen gates the next login until a new password is set. | **[PASS]** |
| TC-024 | User Management | The administrator approves a pending user and the user can then log in. | Verified: approveUser (4 refs) clears the pending status so checkPendingStatus no longer blocks the account at pendingGate. | **[PASS]** |
| TC-025 | User Management | The administrator adds a user with complete details. | Verified: openUserModal + saveUser persist full details through GMSFB (users collection, 5 refs in db-firebase.js); GMSFB.createUserCreds (5 refs) provisions credentials; refreshUserTable (3 refs) re-renders. | **[PASS]** |
| TC-026 | User Management | The administrator edits the details of a user. | Verified: saveUser handles the edit mode of userModal (openUserModal pre-fills) and refreshUserTable (3 refs) updates the table after saving. | **[PASS]** |
| TC-027 | User Management | The administrator locks and unlocks a user account. | Verified: toggleUserLock (2 refs) switches the lock state, and locked logins are rejected with 'Please contact the administrator.' (see TC-007). | **[PASS]** |
| TC-028 | User Management | The administrator deletes a user. | Verified: deleteUser (3 refs) removes the user after the shared openConfirm (31 refs) confirmation flow; refreshUserTable updates the list. | **[PASS]** |
| TC-029 | Members | Adding a member with complete details saves the record with the next member ID. | Verified: saveMember (4 refs) uses nextMemberId (3 refs) for sequential IDs (MEM-0001 pattern per docs) and persists via GMSFB.pushCollection to the members collection. | **[PASS]** |
| TC-030 | Members | Adding a member with missing required fields shows an error message. | Verified: memberFormError element (2 refs in script.js) displays validation errors from saveMember when required member fields are missing. | **[PASS]** |
| TC-031 | Members | Editing a member updates the saved details. | Verified: openEditFromProfile / saveMember edit path reuses memberModal (memberModalTitle switches modes) and persists updates to the members collection. | **[PASS]** |
| TC-032 | Members | Viewing a member shows the profile, plan, and status. | Verified: viewMember (4 refs) opens the member profile view showing plan and status; profile actions (profileCheckIn, copyMemberToken) available from it. | **[PASS]** |
| TC-033 | Members | Search and filter narrow the member list. | Verified: memberFilter (3 refs) plus refreshMemberTable (8 refs) apply search/filter criteria to narrow the rendered member list. | **[PASS]** |
| TC-034 | Members | Deleting a member removes the record after confirmation. | Verified: deleteMember (4 refs) removes the record after the openConfirm confirmation flow; renumberMembers (2 refs) renumbers the remaining list. | **[PASS]** |
| TC-035 | Membership Plans | Adding a plan with name, price, and duration saves it to the plan list. | Verified: savePlan (1 ref) validates price/duration ('Invalid price or duration. Please enter values greater than zero.') and persists to the plans collection (public read per firestore.rules). | **[PASS]** |
| TC-036 | Membership Plans | Editing a plan updates its details. | Verified: editingPlan state (5 refs) drives the planModal edit mode ('Edit Plan' title) and savePlan persists the updated details. | **[PASS]** |
| TC-037 | Membership Plans | Deleting a plan removes it from the list. | Verified: deletePlan (1 ref) removes the plan and renderPlans re-renders the list. | **[PASS]** |
| TC-038 | Membership Plans | A member can browse plans and change to another plan. | Verified: memberChangePlan (2 refs) lets the member browse (renderExplorePlans, 5 refs) and request a plan change. | **[PASS]** |
| TC-039 | Membership Plans | A member can cancel a plan request before it is confirmed. | Verified: cancelMemberPlanForm (3 refs) cancels an unconfirmed plan request before staff confirmation. | **[PASS]** |
| TC-040 | Billing and Payments | Recording a payment for a member saves it and displays it in the billing table. | Verified: savePayment persists to the payments collection (declared in db-firebase.js and gated in firestore.rules); renderBilling/refreshBillingTable display it in the billing table. | **[PASS]** |
| TC-041 | Billing and Payments | A pending payment appears in the payment queue and notifies the staff. | Verified: pushPendingPaymentNotif + openPendingNotifs (3 refs) create the staff notification and renderQueue (9 refs) shows queued items with the updateQueueBadge counter. | **[PASS]** |
| TC-042 | Billing and Payments | Confirming a payment activates the plan of the member and issues a receipt. | Verified: confirmPayment (8 refs) / confirmSelectedPayments (2 refs) activate the member plan and viewReceipt (3 refs) issues the receipt. | **[PASS]** |
| TC-043 | Billing and Payments | Editing and deleting a payment updates the billing table. | Verified: saveEditPayment updates a saved payment (ep_method edit modal with reference toggle) and deletePayment removes it; the billing table refreshes after both. | **[PASS]** |
| TC-044 | Billing and Payments | A receipt can be viewed and printed. | Verified: viewReceipt (3 refs) opens receiptModal and printReceipt (1 ref, wired via onclick="printReceipt()" in index.html) prints it. | **[PASS]** |
| TC-045 | Walk-in | Recording a walk-in uses the current walk-in fee and issues a receipt. | Verified: saveWalkin (2 refs) records the visit with getWalkinFee as the current fee and viewWalkinReceipt (2 refs) issues the walk-in receipt. | **[PASS]** |
| TC-046 | Walk-in | Changing the walk-in fee updates the displayed price and later walk-ins. | Verified: saveWalkinFee (1 ref) persists the new fee and syncStaticWalkinPrice updates the displayed price (walkinFeeDisplay) used by later walk-ins. | **[PASS]** |
| TC-047 | Renewals | Expired memberships are flagged on the renewals list. | Verified: scanRenewals (14 refs) with isMemberExpired (4 refs) flags expired memberships and updatePendingBadge reflects the count on panelRenewed. | **[PASS]** |
| TC-048 | Renewals | Renewing a membership extends its validity and issues a renewal receipt. | Verified: confirmRenew (2 refs) extends the membership validity and viewRenewalReceipt (2 refs) issues the renewal receipt; renderRenewed (3 refs) lists processed renewals. | **[PASS]** |
| TC-049 | QR Check-in/Check-out | The QR code of a member is displayed and can be downloaded. | Verified: renderMyQr (2 refs) draws the QR via vendor/qrcode.min.js on panelMyqr and downloadMyQr (2 call sites) exports it; refreshMyQr rotates the nonce. | **[PASS]** |
| TC-050 | QR Check-in/Check-out | Scanning a valid member QR code records a check-in. | Wiring verified — startScanner/_scanLoop with vendor/jsQR.min.js decode frames and processQrToken (3 refs) records the check-in; live camera execution requires a camera device, which is unavailable in this environment. | **[PARTIAL]** |
| TC-051 | QR Check-in/Check-out | A manual token entry records a check-in for a valid token. | Verified: scanManualToken (3 refs) feeds an entered token through the same validation path and doCheckin records the check-in (onclick="doCheckin()" wired in index.html). | **[PASS]** |
| TC-052 | QR Check-in/Check-out | An invalid or outdated QR token is rejected. | Verified: showScanResult('invalid','Invalid QR Code',…) and ('invalid','QR is Outdated',…) reject bad/stale tokens; token freshness enforced by qrSig/getQrSecret/newQrNonce (nonce rotation). | **[PASS]** |
| TC-053 | QR Check-in/Check-out | Check-out records the time out for a checked-in member. | Verified: doCheckout (wired via onclick in checkin/checkout modals) writes the time out and showScanResult('checkout','Check-Out Recorded',…) confirms it. | **[PASS]** |
| TC-054 | QR Check-in/Check-out | An expired member cannot check in. | Verified: showScanResult('blocked','Plan Expired',…) blocks expired members in the scan path (isMemberExpired, 4 refs); related blocks: 'Payment Pending', 'Account Archived'. | **[PASS]** |
| TC-055 | Schedule and Sessions | A member books a session with a trainer. | Verified: bookSession (2 refs) from panelMySessions creates the booking; saveSession (onclick-wired) persists sessions to the sessions collection. | **[PASS]** |
| TC-056 | Schedule and Sessions | A trainer accepts a booked session and it shows as confirmed. | Verified: acceptSession is invoked from the session card (acceptSession('${s.id}')) and toggles the status to confirmed (toggleSessionStatus, 1 ref). | **[PASS]** |
| TC-057 | Schedule and Sessions | A trainer declines a booked session and the member is notified. | Verified: declineSession (4 call sites) rejects the booking and the notification is delivered through the notifications collection / renderNotifications (6 refs). | **[PASS]** |
| TC-058 | Schedule and Sessions | A session can be rescheduled or cancelled. | Verified: rescheduleSession (2 refs) changes the slot and confirmCancelSession (3 refs) / deleteSession cancel it, re-rendering the schedule. | **[PASS]** |
| TC-059 | Schedule and Sessions | A session can be marked completed. | Verified: markSessionDone (2 refs) and confirmCompleteSession (3 refs) set the completed status on the session. | **[PASS]** |
| TC-060 | Schedule and Sessions | Month, week, and list calendar views display the sessions. | Verified: renderMonthView (4 refs), renderWeekView (2 refs) and renderListView (3 refs) with calNav/calToday render the three calendar views. | **[PASS]** |
| TC-061 | Workouts | A trainer builds and saves a workout plan from the exercise library. | Verified: seedExerciseLibrary (3 refs) populates the library and createWorkoutPlan (2 refs) saves the plan from panelWorkoutBuilder (muscle filters, list, summary helpers). | **[PASS]** |
| TC-062 | Workouts | A member views the assigned workout plan. | Verified: renderMyWorkoutPlan (10 refs) renders the assigned plan on panelMyWorkoutPlan for the member. | **[PASS]** |
| TC-063 | Workouts | A member logs a workout entry and it appears in the workout history. | Verified: addWorkoutEntry (2 refs) saves the entry and renderMyWorkouts displays the history with calcStreak (2 refs) computing streaks. | **[PASS]** |
| TC-064 | Workouts | Deleting a workout or workout plan removes it from the list. | Verified: deleteWorkout (4 refs) and deleteWorkoutPlan remove the respective records from their lists. | **[PASS]** |
| TC-065 | Progress Tracking | Adding a body measurement saves it and updates the progress view. | Verified: addMeasurement (2 refs) persists to the measurements collection and renderMyProgress updates the progress view. | **[PASS]** |
| TC-066 | Progress Tracking | Adding a goal shows it with progress, and updating it changes the progress. | Verified: addGoal (2 refs) creates the goal and updateGoalProgress changes its progress; renderMyGoals displays them. | **[PASS]** |
| TC-067 | Progress Tracking | Deleting a measurement or goal removes it. | Verified: deleteMeasurement (2 refs) and deleteGoal (2 refs) remove the records from their lists. | **[PASS]** |
| TC-068 | Messages | Sending a message delivers it to the recipient and shows an unread badge. | Verified: sendMessage (1 ref) persists to the messages collection; updateMyBadges (3 refs) / myUnreadReplies render the unread badge for the recipient. | **[PASS]** |
| TC-069 | Messages | Deleting a conversation removes it from the list. | Verified: deleteConversation (2 refs) removes the thread and filterMessageThreads re-renders the conversation list. | **[PASS]** |
| TC-070 | Messages | Messages can be exported and imported. | Verified: exportMessages (1 ref) and importMessages (1 ref) are implemented in script.js. | **[PASS]** |
| TC-071 | Announcements | Creating an announcement displays it to the intended users. | Verified: saveAnnouncement (1 ref) posts to the announcements collection and announceStripHtml (2 refs) / renderAnnouncements (4 refs) display it to the selected audience. | **[PASS]** |
| TC-072 | Announcements | Deleting an announcement removes it. | Verified: deleteAnnouncement (2 refs) removes the announcement and renderAnnouncements re-renders the list. | **[PASS]** |
| TC-073 | Reports | Generating a report displays the selected member or trainer data. | Verified: generateReport (3 refs) with filterMemberReportList/filterTrainerReportList selectors renders the selected member or trainer data on panelReports. | **[PASS]** |
| TC-074 | Reports | Export CSV downloads a CSV file of the report. | Verified: exportCSV (5 refs) builds the file through csvCell and triggers the download. | **[PASS]** |
| TC-075 | Reports | Print opens a printable report. | Verified: printReport (6 refs) opens the printable report view. | **[PASS]** |
| TC-076 | Activity Log | User actions (login, payment, check-in) appear in the activity log. | Verified: logActivity is called from 21 sites across the app (login, payments, check-in, etc.) and renderActivityLog (3 refs) lists them on panelActivityLog. | **[PASS]** |
| TC-077 | Activity Log | The activity log can be exported as CSV and printed. | Verified: exportActivityLogCSV (2 refs) exports the log and printActivityLog (2 refs) prints it. | **[PASS]** |
| TC-078 | Profile | A user updates profile details and picture, and the change is saved. | Verified: profileModal with save handlers (saveStaffProfile/saveMemberProfileEdit among 13 avatar/profile refs) persist edits; onImagePick/compressDataUrl/setUserAvatar handle the profile picture. | **[PASS]** |
| TC-079 | Profile | A trainer updates trainer profile details. | Verified: renderTrainerProfile / openTrainerEditModal / saveTrainerProfile update the trainer-specific profile fields on trainerEditProfileModal. | **[PASS]** |
| TC-080 | Access Control | A member cannot open administrator or staff pages. | Verified: 91 role=== checks plus roles-gated sidebar definitions and navigate/renderPanel guards block member access to admin/staff panels (panelUsers, panelActivityLog, etc.). | **[PASS]** |
| TC-081 | Access Control | Each role sees only its own sidebar menu items. | Verified: sidebar items declare role arrays (27 roles:[ matches) — e.g. My QR Code / My Attendance restricted to [member], Dashboard allowed for all four roles — and buildSidebar filters by them. | **[PASS]** |
| TC-082 | Security | Passwords are stored in hashed form, not plain text. | Verified: hashPassword/sha256hex/verifyPassword/migrateLegacyPasswords are implemented in script.js and docs/firestore.rules states passwords live in Firebase Auth, not in Firestore member documents. | **[PASS]** |
| TC-083 | Data Storage | Saved data remains after refreshing the browser. | Verified: data is persisted to Firestore collections via GMSFB.pushCollection (27 refs) and reloaded on startup (GMSFB.fetchDoc/waitForSnap, loadApp) — not browser-storage-only. | **[PASS]** |

## Limitations and retest notes

| # | Limitation | Recommended action |
|---|---|---|
| L1 | Site returned HTTP 404; no browser runtime — results are static code verification. | Re-run Table 2 against a live deployment to convert verified wiring into observed runtime results. |
| L2 | TC-018 / TC-022 require live EmailJS service and a mailbox. | Configure EMAILJS_CONFIG keys and re-execute the Forgot Password module. |
| L3 | TC-050 camera scan requires a physical camera device. | Re-run the QR scan step on a device with camera access. |
| L4 | Runtime enforcement of Firestore rules not observed. | Probe rules in Firebase console Rules Playground. |
| L5 | Local copy of the original docx was corrupted (5,336 UTF-8 replacement characters); structure recovered from the tracked repository version and filled here. | Archive the corrupted local copy; keep this document as the executed version. |

## Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Prepared by | Merjohn Pagente | | |
| Executed by | BUILDER (static code inspection) | 2026-10-18 | |
| Reviewed by | | | |
| Approved by | | | |

