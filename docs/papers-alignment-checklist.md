# FitCore GMS — Papers Alignment Checklist (layout-locked, content-only fix)

> Base: limpyo nga `FITCORE_GYM-MANAGEMENT_SYSTEM-SOFT-ENG.docx` → save as `...-FIXED.docx`.
> Ayaw gamita ang workspace copy (corrupted: `* text=auto` nag-guba sa binary; na-fix na sa
> .gitattributes: `*.docx binary`). Layout WALAY usbon — Heading/styles/numbering/header/footer/TOC/captions same.

## Tag per item (isulat sa CHANGELOG)
- [OK] — match na sa system
- [MISSING-sa-papers] — naa sa system, wala sa papers → dugangan (same style)
- [EXTRA-wala-sa-system] — naa sa papers, wala sa system → default: tangtangon o Future Work (pilian: A=tangtang, B=Future Work)
- [OUTDATED-screenshot] — screenshot dili na match sa UI → retake same size/position
- [TODO] — kulang ug data (ayaw imbentoha; pangutan-a ang student)

## Chapter checklist
- [ ] Cover/Header/Footer/TOC: tanan `GMS` (walay `GMMS`); page numbers intact
- [ ] Abstract/Objectives/Scope = 5 roles + modules sa fitcore-system-truth.md ra
- [ ] Ch2 Requirements/UseCases = Fig1 + T4 (12 cases, 51 onclick fns)
- [ ] Ch3 Design = Fig2 L0, Fig3 L1 (1.0-9.0), Fig4 L2-Payments, Fig5 ERD, Fig6 Arch + T1/T2/T3
- [ ] Ch3 Sequences = Fig7-13 S1-S7 + T5-T11 (kopyaha sa papers-tables.md)
- [ ] Ch4 Implementation = screenshot per core panel (Signup, Login, Members, Billing+Receipt, Checkin/out, Walkin, Sessions, Plans, Reports) same frame size
- [ ] Ch4 = 4 new figures (image20-23 sa REVISED) i-number ug tarong, i-mention sa text
- [ ] Ch5 Testing = valid/invalid login, pending gate, expiry-after-confirm, fee calc, QR checkin, book→accept
- [ ] References/Appendices format same (APA o IEEE — usa ra, consistent)

## CHANGELOG template (kopyaha, pun-a per fix)
| Page/Fig | Before | After | Reason | Tag |
|---|---|---|---|---|
| Cover | GMMS | GMS | Typo, user-confirmed | [OK] |
| Fig X | (old diagram) | (system-matched, same frame) | Align to code | [MISSING-sa-papers] |
| Ch4 p.__ | (old screenshot) | (retake same size) | UI outdated | [OUTDATED-screenshot] |

## [NEEDS-VERIFY] / [TODO] log (ayaw hallucinate)
| # | Item | Need from student |
|---|---|---|
| 1 | Test results / survey data | Real numbers, dili imbentohon |
| 2 | Adviser red marks (kung naa) | Chapter + page sa comment |
| 3 | Extra features sa papers nga wala sa code | Pilian: A=tangtang, B=Future Work |

## Done kung
- [ ] Zero portfolio-refresh references / title typo (gawas sa git history)
- [ ] Figures 1-15 + Tables T1-T11 numbered, tanan gi-mention sa text
- [ ] Styles count same, pages ±2 ra, walay bag-ong fonts/colors/sections
