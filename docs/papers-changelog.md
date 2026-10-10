# Papers CHANGELOG — FIXED vs ORIGINAL (text-only, layout intact)

> Base: `FITCORE_GYM-MANAGEMENT_SYSTEM-SOFT-ENG.docx` (limpyo nga GitHub copy, NOT revised)
> Output: `FITCORE_GYM-MANAGEMENT_SYSTEM-SOFT-ENG-FIXED.docx` (3.7MB, 998 paras — same count, 0 insertions/deletions)
> Scope: text replacements ONLY in word/document.xml. Diagrams, tables, figures, images, styles — untouched.
> Layout lock: styles.xml, numbering.xml, theme, header1, fontTable, settings, docProps, ALL 19 media files (incl. image1 logo) — byte-identical. Strict XML validated.

## Proof nga intact ang layout
- Paragraphs: 998 = 998 (walay nadugang, walay natangtang)
- Changed paras: 43/998 (95.7% identical) — puro intended fix spots ra
- Figures: 19 = 19 (Use Case diagram, Sequence diagram, Activity diagrams — same tanan)
- Tables: 13 = 13 (Use Case tables — same tanan)
- Images: 19/19 byte-identical (logo image1 apil)
- document.xml: strict XML VALID, paras/tables balanced

## Text fixes (system == papers: localStorage → Firebase/Firestore)
| # | Location | Before | After |
|---|---|---|---|
| 1 | Intro [25] | "monitor equipment" (wala sa system) | "organize trainer schedules" |
| 2 | Delimitation [52] | browser-based local storage, "upgrade to server-based in future" | cloud backend: Firebase Authentication + Cloud Firestore (fitcoregym-1019f), role-based rules |
| 3 | Database Design [80] | "organized relational database with specific tables" | cloud database (Cloud Firestore) with collections (users/members/payments/attendance/walk-ins/sessions/plans/messages/settings) |
| 4 | Database Design [80] | "These tables are connected" | "These collections are linked" |
| 5 | NFR Security [101] | "encrypted passwords" | passwords in Firebase Authentication, never in database |
| 6 | NFR Data Integrity [102] | "relational data model with primary keys and constraints" | Cloud Firestore collections with unique identifiers (MEM-0001) + validation rules |
| 7 | NFR Scalability [105] | "The database is designed" | "Cloud Firestore scales automatically" |
| 8 | Software Specs [219] | localStorage API, offline OK | Firebase backend, internet required for auth/sync |
| 9 | Flows (login, register, members, attendance, schedule, walk-in, reminders, plans, reports, users, logout) | LocalStorage / stored locally | Cloud Firestore / Firebase Authentication sign-out |
| 10 | Diagram lifelines (24 cells) | LocalStorage | Cloud Firestore |
| 11 | Glossary localStorage | browser mechanism | cloud mechanism via Firebase (fitcoregym-1019f) |

## Verification
- [x] localStorage: 0 | Firebase 7x, Cloud Firestore 41x | GMMS: 0
- [x] Roles/scope untouched (Staff/Trainer self-register sama sa original — walay gidugang nga Member signup)
- [x] DFD/ERD/FR-15 extras: WALA gisulod sa docx (naa sa docs/*.md as specs) — per "ilisdi ra ang text" instruction
