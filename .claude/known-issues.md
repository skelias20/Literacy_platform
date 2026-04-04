# Known Issues — Session VI

**Session V fixes applied:** ISSUE-01 through ISSUE-09, ISSUE-11/24, ISSUE-14, ISSUE-15, ISSUE-17, plus payment reject route auth/schema bugs.

**Session VI fixes applied:** Periodic "check back soon" bug (slot session number), admin artifact source content access, admin list shows session 1 immediately on submission, session counter on student dashboard, slot replacement UI, assign-level only on last tab, assign-level uses active session ID.

Remaining items below are either pending verification, planned features, or require product decisions.

This file is now organized into three categories:

1. **Critical Bugs / Current Implementation Issues** — concrete bugs, regressions, and behavior mismatches that should be fixed before adding new features.
2. **System Constraints / Workflow Rules** — important product and system behavior rules that must be enforced to avoid future bugs or inconsistent logic.
3. **Future Features / Architecture Decisions** — not necessarily bugs, but important missing capabilities, schema decisions, and scalability concerns that must be planned deliberately.

---

## How to use this file

For each item:
1. Read the description and potential solution
2. Find the relevant files or routes
3. Fix the issue with the smallest correct change
4. Test the exact affected workflow end-to-end
5. After fixing, delete the item from this file and commit

---


# 2. System Constraints / Workflow Rules


# 3. Future Features / Architecture Decisions

## ISSUE-19: Monthly subscription renewal — IMPLEMENTED ✔

**Implemented in Session XI.** See `.claude/billing-subscription.md` for full spec.
Migration: `add_billing_subscription` (applied). Data backfill included in migration SQL.

---

## ISSUE-21: Evaluate whether current JWT auth is enough for multi-server scalability (IMPLEMENTED ✔ with redis upstash deffered)

**Implemented** see `.claude/security-audit.md `

---


## ISSUE-24: Mobile and PC responsiveness — platform-wide UX audit needed

**Area:** Frontend UX / responsive design

**Problem:**
The platform UI was built primarily for desktop. Students (children) and parents are likely to access the platform on mobile devices, particularly for tasks and assessments. Unresponsive layouts, small tap targets, horizontal overflow, and non-touch-friendly controls create friction and accessibility problems. The admin panel is secondary — desktop-first is acceptable there — but the student-facing experience must be genuinely usable on mobile.

**Scope:**
- Student UI: dashboard, assessment pages, daily task pages, listening player, audio recorder, writing input
- Admin UI: at minimum must not break on tablet; full mobile support is lower priority
- Backend: no changes expected — this is almost entirely a UI concern

**Specific concerns to address:**
- Layout: use responsive Tailwind breakpoints (`sm:`, `md:`) throughout student pages
- Touch targets: buttons and interactive elements must meet minimum 44×44px tap size
- Typography: base font size must be readable on small screens without zoom
- Audio recorder: `MediaRecorder` flow must work on mobile browsers (Safari iOS has known limitations with `audio/webm` — may need format detection fallback)
- Listening player: progress bar and controls must be touch-friendly
- Writing textarea: must not be obscured by on-screen keyboard on mobile — use `scroll-into-view` or `dvh` units
- Image/content display: content items must scale correctly on narrow viewports
- Navigation: student nav must be accessible without horizontal scroll on 375px width screens

**Planned enhancement already in backlog:**
ISSUE-20 (optional instructional video URL per task/assessment) is part of this broader initiative — embedding an explanatory video on a task or assessment page directly reduces the need for external guidance and improves mobile-first discoverability.

**Suggested approach:**
1. Audit each student-facing page at 375px (iPhone SE) and 768px (tablet) widths
2. Fix layout, spacing, and touch targets per page
3. Validate audio recording on iOS Safari specifically
4. Apply minimal responsive improvements to admin panel (no horizontal overflow)

**Priority:** High for student pages — should be addressed before any public-facing release.

---


