# Papers CHANGELOG — FIXED vs REVISED (content-only, layout intact)

> Base: `FITCORE_GYM-MANAGEMENT_SYSTEM-SOFT-ENG-REVISED.docx` (limpyo nga GitHub copy)
> Output: `FITCORE_GYM-MANAGEMENT_SYSTEM-SOFT-ENG-FIXED.docx` (3.75MB, 1245 paras, 23 figures, 20 tables)
> Layout lock: styles.xml, numbering.xml, theme, header, images, fonts — byte-identical. XML validated (paras + tables balanced).

## Core fix: system == papers (localStorage → Firebase/Firestore)
| # | Location | Before | After |
|---|---|---|---|
| 1 | Delimitation [52] | browser-based local storage, "upgraded to server-based in future" | Cloud backend: Firebase Authentication + Cloud Firestore (fitcoregym-1019f), role-based rules |
| 2 | System Design [78] | client-side, all data in browser localStorage API | client-server: Firebase backend (Auth verifies, Firestore stores) |
| 3 | Database Design [80] | browser-based store, "tables" | Cloud Firestore collections (users/members/payments/attendance/walk-ins/sessions/plans/messages/workouts/settings), custom IDs MEM-0001, passwords only in Auth |
| 4 | FR-01 | username+password (generic) | + through Firebase Authentication |
| 5 | NFR Security [103] | "encrypted passwords" | passwords in Firebase Auth, never in database |
| 6 | NFR Data Integrity [104] | browser localStorage | Cloud Firestore collections + MEM-0001 |
| 7 | NFR Reliability [106] | runs inside browser | real-time cloud synchronization |
| 8 | NFR Scalability [107] | database designed for growth | Firestore auto-scales |
| 9 | Software Specs [219] | HTML/CSS/JS + jsQR only | + Firebase Auth + Firestore (fitcoregym-1019f) |
| 10 | Software Specs [221] | localStorage API, offline OK | Firebase backend, internet required for auth/sync |
| 11 | Flows (login, register, members, attendance, schedule, walk-in, reminders, plans, reports, users, logout, messaging, announcements, billing) | LocalStorage / stored locally | Cloud Firestore / Firebase Authentication sign-out |
| 12 | Sequence tables (lifelines) | LocalStorage (32 cells) | Cloud Firestore |
| 13 | Glossary localStorage + Data Storage | browser mechanism | Cloud Firestore entries |
| 14 | Introduction [25] | "monitor equipment" (wala sa system) | removed (trainer schedules) |

## Added (same styles, cloned from existing elements)
| # | Item | Position |
|---|---|---|
| 15 | FR-15 Forgot-Password Recovery (OTP via EmailJS) | after FR-14 |
| 16 | ERD description para (entities, MEM-0001/u1, passwords policy) | after Entity-Relationship Diagram heading |
| 17 | Data Flow Diagram section (L0 + L1 text) | before APPENDIX A |
| 18 | Table 19: DFD Level 0 – Context Flows (7 rows) | DFD section |
| 19 | Table 20: DFD Level 1 – Processes and Data Stores (10 rows) | DFD section |
| 20 | References: Firebase Auth + Cloud Firestore docs | after jsQR entry |
| 21 | Glossary: Firebase Authentication + One-Time Password (OTP) | alphabetical spots |

## Verification
- [x] localStorage/MMS typos: 0 | Firebase 20x, Cloud Firestore 54x
- [x] Figures 1–23 intact, Tables 1–20 numbered, FR-01–FR-15
- [x] document.xml: paras 1786/1786 balanced, tables 20/20, zero strays
- [x] Untracked risk: DFD has no drawn figure images (tables 19–20 carry the flows); screenshots unchanged
