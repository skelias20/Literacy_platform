# Liberty Library Platform
## Developer Checklist
### Version IV — Engineering Backlog & Roadmap

> **Note:** This document is NOT a system instruction. It is a structured engineering backlog. Items here are NOT automatically approved. Always verify against the current schema, working architecture, and migration safety before implementing.

---

### COMPLETED

#### Infrastructure
* R2 upload presign + confirm three-step flow 
* JWT auth canonicalization (lib/auth.ts, role claims, HS256) 
* Shared Zod validation layer (lib/parseBody.ts + lib/schemas.ts) 
* Sliding window rate limiter (disabled in dev) 
* proxy.ts route protection 
* Cloudflare Worker: queue consumer + cron orphan sweep 
* fetchWithAuth wired into all authenticated pages 
* add_missing_indexes migration applied 

#### Admin Panel
* Student CRUD: list, detail, edit, password reset, archive/unarchive, RP total 
* Payment approval flow with secure R2 receipt viewing 
* Content library: upload, preview, edit, archive, assessment slot badges 
* Daily task creation: all formats, question bank, writing constraints, RP config 
* Admin daily review with structured Q&A display 
* Assessment review with session tabs, allSessions artifacts, assign/update level 
* Assessment config panel: initialSessionCount, slot readiness grid 
* Assessment content slots: assign per (level, skill, sessionNumber) 
* Question bank builder in assessment slot panel (mixed formats, always-visible selector) 
* Periodic re-evaluation trigger (all / by level) 
* Student activity monitor with per-skill breakdown 
* AdminAuditLog writes: level assigned, level changed, profile edited, periodic triggered 

#### Student Flow
* Registration with R2 receipt upload + favourite subjects 
* Student login with archived account blocking 
* Initial assessment: multi-session, level-aware content, one-shot submit 
* Assessment: time-aware "take tomorrow" recommendation between sessions 
* Periodic re-evaluation: pending banner, submitted banner 
* Daily tasks: all formats, 3-retry structured listening, writing constraints, RP 
* Student dashboard: RP total, today tasks, all assessment state banners 
* Student logout 

---

### COMPLETED (Session VIII)

#### Admin student panel
* Per-student periodic trigger button in student detail panel — `scope: "student"` added to `trigger-periodic` route; two-step confirmation UI; only visible for active non-archived students; audit action fixed from `LEVEL_CHANGED` → `PERIODIC_TRIGGERED` for all scopes (ISSUE-23)

---

### COMPLETED (Session VII)

#### Daily task management (admin)
* Admin delete daily task — DELETE /api/admin/daily-tasks/[taskId], blocked if any submission isCompleted, two-step confirmation UI
* ISSUE-13 confirmed already implemented — default-content DELETE rejects clearing slots within initialSessionCount

#### Daily task listening (student)
* Client-side scoring for attempts 2 and 3 — only attempt 1 persisted to DB; attempts 2–3 score locally against correct answers returned from attempt 1; attempt 3 posts lock-only (no answers) to server

---

### COMPLETED (Session VI)

#### Assessment review (admin)
* Admin can review session 1 artifacts immediately after submission (no longer waits for all sessions)
* Pending list shows "Session N of M — more sessions pending" or "All N sessions submitted — ready for level assignment"
* Assign level button only appears on the last session tab
* Assign level now sends the active (last) session's ID — not the clicked list-row's ID
* Admin artifact panel shows source content title + collapsible text / audio download link
* Periodic assessment "check back soon" bug fixed — slots always looked up at session 1

#### Student dashboard
* Session counter on assessment_required banner: "Session X of Y" pill with contextual description
* Unknown Word List / vocabulary pool — storage model undefined, consumption unclear

#### Slot management (admin)
* Protected slots (within saved session count) show "Replace with…" dropdown instead of blocked Clear
* Missing slots shown as grouped clickable list with quick-navigate to level panel
* Empty slot rows highlighted amber

---


### PENDING — NEAR TERM

* **ISSUE-17:** Grade range enforcement (1–8) — frontend validation + backend Zod refinement on registration route.

* **ISSUE-24:** Mobile/PC responsiveness audit — student-facing pages first (dashboard, assessment, tasks, audio recorder). Admin panel: no horizontal overflow at tablet width minimum.

* **ISSUE-25:** Admin student status clarity — action hints per status, periodic assessment pending badge on active students, `lastDailySubmissionAt` staleness indicator in detail panel.

* **ISSUE-26:** Differentiate initial vs periodic assessment review UI — type badge, "Update Level" vs "Assign Level" label, level-change confirmation step, split list sections.

* Refresh-token flow — deferred
* Redis-backed rate limiter — deferred

---

### DEFERRED — P3+
* Admin-configurable recording duration per task 
* Parent notification system (SMS/email) 
* Analytics dashboard — requires event tracking architecture first 
* AI evaluation layer: writing scoring, pronunciation, comprehension grading 
* Adaptive difficulty / vocabulary progression model 
* AI writing evaluation rubric 
* Behavioral engagement analytics 
* Teacher intervention tools 
* Multi-tenant / cohort architecture 

---

### ENGINEERING DISCIPLINE RULES
* Items in this checklist are NOT automatically approved 
* Always verify against system instruction, current schema, migration safety 
* Never break state machine, automate admin authority, or redesign upload pipeline casually 
* Major lifecycle features require: schema design, migration sequencing plan, backward compat analysis 