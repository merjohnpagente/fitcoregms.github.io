# FitCore GMS — Papers Tables (paste-ready, same table style sa layout)

## T1 Entities
| Actor/System | Description |
|---|---|
| Guest | Unauthenticated visitor: browse landing/plans/trainers, signup, login, forgot-OTP |
| Member | Self-service: QR, attendance, sessions booking, workouts/progress/goals, messages, payments |
| Trainer | Coaching: profile/availability, assigned sessions, workout builder, exercise library |
| Staff/Admin | Full CRUD: members, billing+receipts, check-in/out, walk-ins, plans, users, reports |
| Firebase Auth | Layer-1 auth gate (passwords diri ra, wala sa Firestore) |
| Firestore | Layer-2 data (18 collections, project fitcoregym-1019f) |

## T2 Data Stores
| ID | Collection | Access | Purpose / Module |
|---|---|---|---|
| D1 | users | auth | Staff/trainer/admin accounts, roles — Users panel |
| D2 | members | public-read (login lookup) / auth-write | Profiles, signup — Members, Signup, Billing, Sessions |
| D3 | plans | public-read / auth-write | Catalogue — Plans, Landing Explore, Signup |
| D4 | payments | auth | Transactions/receipts — Billing, Renewed |
| D5 | attendance | auth | Check-in/out logs — Scanner, Checkin/out, Logs |
| D6 | walkins | auth | Visitor entries — Walk-in, Queue |
| D7 | sessions | auth | Bookings — Schedule, MySessions |
| D8 | announcements | auth | Broadcasts — Announcements |
| D9 | messages/notifications | auth | Threads + badges — Messages, Notifications |
| D10 | workouts/workoutPlans/measurements/goals | auth | Member fitness logs — MyWorkouts/Progress/Goals |
| D11 | settings/meta | public-read / auth-write | Gym config, walk-in fee, bootstrap |
| D12 | activitylog | auth | Audit trail — ActivityLog, Reports |

## T3 Data Flows (L0 + L1)
| From → To | Data | Description |
|---|---|---|
| Guest → 0 | browse, signup info | Landing explore, member signup form |
| 0 → Guest | plans list, trainers list | Public catalogue (D3, trainer profiles) |
| Member → 0 | login, payment, booking, attendance | doLogin, savePayment, bookSession, doCheckin |
| 0 → Member | receipt, schedule, profile | printReceipt, sessions, member data |
| Trainer → 0 | profile, availability, session update | saveTrainerProfile, session confirm |
| 0 → Trainer | assigned sessions | MyAssigned |
| Staff → 0 | all CRUD | Members, payments, walk-ins, plans, users |
| 0 → Staff | dashboard, reports, receipts | KPIs, CSV, receipts |
| 0 ↔ Auth | verify/create/reset | Login, register, forgot-OTP |
| 0 ↔ Firestore | store/read D1-D12 | All modules |

## T4 Use Case description (sample; sunduga per case)
| Case | Actor | Pre / Post | Main steps |
|---|---|---|---|
| Login | All | Pre: registered. Post: dashboard or pendingGate | 1 enter creds → 2 verify Auth → 3 role check → 4 open panel |
| Member Signup | Guest | Pre: plan exists. Post: D2 created, pending | 1 select plan → 2 fill form+consent → 3 create Auth+D2 |
| Record/Confirm Payment | Staff | Pre: member exists. Post: D4 + expiry updated | 1 savePayment → 2 confirmPayment → 3 printReceipt |
| Check-in/out | Staff/Member | Pre: active member. Post: D5 log | 1 search/QR → 2 doCheckin → 3 doCheckout |

## T5-T11 Sequence tables
### S1 Login
| Step | From → To | Message | Data | Store |
|---|---|---|---|---|
| 1 | Actor → UI | login(user, pass) | creds | — |
| 2 | UI → Auth | verify() | auth request | Auth |
| 3 | Auth → DB | get users/members | profile query | D1/D2 |
| 4 | DB → UI | role + status | role, active/pending | D1/D2 |
| 5 | UI → Actor | open dashboard / pendingGate | panel | — |

### S2 Signup + Plan
| Step | From → To | Message | Data | Store |
|---|---|---|---|---|
| 1 | Guest → UI | selectPlan(planId) | plan | D3 |
| 2 | Guest → UI | submitMemberSignup(form) | member form | — |
| 3 | UI → Auth | createUser() | authEmail | Auth |
| 4 | UI → DB | create members | profile (MEM-0001) | D2 |
| 5 | UI → Guest | pendingGate/success | status | — |

### S3 Payment + Receipt
| Step | From → To | Message | Data | Store |
|---|---|---|---|---|
| 1 | Staff → UI | savePayment(member, amount, method) | Cash/GCash/Bank | — |
| 2 | UI → DB | create payments | record | D4 |
| 3 | Staff → UI | confirmPayment(id) | confirm | D4 |
| 4 | UI → DB | update expiry | expiry date | D2 |
| 5 | UI → Staff | printReceipt() | receipt modal | D4 |

### S4 Attendance
| Step | From → To | Message | Data | Store |
|---|---|---|---|---|
| 1 | Member → UI | doCheckin(QR/manual) | token/search | — |
| 2 | UI → DB | create attendance | log | D5 |
| 3 | Member → UI | doCheckout() | checkout | — |
| 4 | UI → DB | update log | checkout time | D5 |

### S5 Session Booking
| Step | From → To | Message | Data | Store |
|---|---|---|---|---|
| 1 | Member → UI | bookSession(trainer, sched) | booking | — |
| 2 | UI → DB | create sessions | record | D7 |
| 3 | Trainer → UI | accept/completeSession() | status | D7 |
| 4 | UI → DB | update + notify | status, notif | D7/D9 |

### S6 Walk-in + Fee
| Step | From → To | Message | Data | Store |
|---|---|---|---|---|
| 1 | Staff → UI | saveWalkin(name) | visitor | — |
| 2 | UI → DB | read settings fee | fee | D11 |
| 3 | UI → DB | create walkins | entry | D6 |

### S7 Forgot-OTP
| Step | From → To | Message | Data | Store |
|---|---|---|---|---|
| 1 | User → UI | sendForgotCode(email/phone) | contact | — |
| 2 | UI → EmailJS | send OTP | code | — |
| 3 | User → UI | fpVerifyCode(otp) | code verify | — |
| 4 | UI → Auth | resetPassword() | new pass | Auth |
