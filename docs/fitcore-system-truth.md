# FitCore GMS — System Truth (papers basehan, layout-locked)

> Title: FitCore GMS — Gym Management System. Firebase project: fitcoregym-1019f.
> Source: index.html (133KB, 399 ids), style.css, script.js (9.9MB build), db-firebase.js,
> firebase-config.js, vendor/ (firebase-compat, qrcode, jsQR), docs/firestore.rules.
> Rule: ang naa sa system mao pud ang naa sa papers. Walay imbento.

## Roles
| Role | Entry | Dashboard builder |
|---|---|---|
| Guest | Landing, loginPage, memberSignup, forgotModal, pendingGate | — |
| Member | Login → MyQR, MyAttendance, MySessions, MyWorkouts/Plan/Progress/Goals, Messages, History | buildMemberDashboard |
| Trainer | Login → MyAssigned, Schedule, ExerciseLibrary, WorkoutBuilder, MySessions | buildTrainerDashboard |
| Staff | Login → Dashboard, Members, Billing, Queue, Scanner, Walkin, Schedule, Renewed, Reports, Messages, Announcements | buildStaffDashboard |
| Admin | All Staff + Users, Plans, ActivityLog, MemberLogs | buildAdminDashboard |

## Modules (panel → function)
- Landing/Auth: landingHome/Features/Trainers/Explore/Register → showLandingSection, renderExplorePlans, renderTrainers
- Login: loginForm → doLogin, doLogout/confirmLogout, togglePw
- Staff Register: registerForm (roleGrid) → selectRegRole, regStep1Next/regStep2Next, doRegister
- Member Signup: memberSignup 3-step + consent/guardian → msStep1Next/msStep2Next, submitMemberSignup
- Forgot: forgotModal OTP (EmailJS) → sendForgotCode, fpVerifyCode, confirmForgotPassword
- Gate: pendingGate → checkPendingStatus
- Dashboard: panelDashboard → renderDashboard, refreshCurrentPanel
- Members: panelMembers → renderMembers, openMemberModal, saveMember, viewMember, deleteMember
- Checkin/out: checkinModal/checkoutModal → doCheckin, doCheckout
- Queue: panelQueue → renderQueue, toggleQueueSelect, deleteQueueItem
- Scanner: panelScanner (jsQR) → startScanner, stopScanner, scanManualToken
- MyQR: panelMyqr (qrcode) → renderMyQr, downloadMyQr, copyMemberToken
- Walkin: panelWalkin + fee settings → saveWalkin, saveWalkinFee, viewWalkinReceipt
- Billing: panelBilling → savePayment (Cash/GCash/Bank), saveEditPayment, deletePayment
- Confirm: confirmPaymentModal → confirmPayment, confirmSelectedPayments
- Receipt/Renewed: receiptModal/panelRenewed → viewReceipt, printReceipt, scanRenewals
- Plans: panelPlans → savePlan, deletePlan
- Schedule: panelSchedule → saveSession, editSession, deleteSession, filterSessionTrainer
- Sessions (member): panelMySessions → bookSession
- Library/Builder: panelExerciseLibrary/panelWorkoutBuilder → seedExerciseLibrary, createWorkoutPlan
- Logs: panelMyWorkouts/MyProgress/MyGoals/MyAttendance/History → addWorkoutEntry, addMeasurement, addGoal
- Comms: panelAnnouncements/panelMessages/panelNotifications → saveAnnouncement, sendMessage, renderNotifications
- Admin: panelUsers/panelActivityLog/panelReports → saveUser, approveUser, toggleUserLock, generateReport, exportCSV

## Data stores (docs/firestore.rules v2.1, custom IDs u1 / MEM-0001)
- Public read: meta, plans, settings, exerciseLibrary, members (login lookup only; passwords in Auth only)
- Auth-required: users, members, payments, sessions, attendance, walkins, announcements, messages, notifications, activitylog, workouts, workoutPlans, measurements, goals
- Relations: members 1—N payments/attendance/sessions/measurements/goals; plans 1—N members/payments; users(trainer) 1—N sessions
