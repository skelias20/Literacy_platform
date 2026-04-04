# Analytics Dashboard
## Liberty Library Literacy Platform

> **Status:** Designed, not yet implemented.
> Read this before implementing any analytics route or page.

---

## 1. Design Principles

- **Admin-only.** No student-facing analytics.
- **Read-only.** Analytics never writes to the database.
- **No external service.** All data comes from existing Postgres tables.
- **Cached responses.** Analytics route returns `Cache-Control: s-maxage=900` (15-minute CDN cache). These are not real-time dashboards.
- **No new schema required** to build the initial dashboard. Some future panels (§7) need minor schema additions — those are optional and listed separately.
- **Single API route.** `GET /api/admin/analytics` returns all panels in one response. No per-panel endpoints — reduces round trips and simplifies the page.

---

## 2. Route

```
GET /api/admin/analytics
```

**Auth:** `verifyAdminJwt` — admin only.  
**Response:** Single JSON object with named panel keys (see §5).  
**Cache:** `Cache-Control: s-maxage=900, stale-while-revalidate=300`  
**Implementation:** Mix of Prisma `groupBy`, `count`, `aggregate`, and `$queryRaw` for complex aggregates.

---

## 3. Page

```
/admin/analytics
```

New page file: `app/admin/analytics/page.tsx`  
Link from admin dashboard `app/admin/page.tsx` — add "Analytics" nav item alongside Payments, Assessments, etc.

**Chart library:** `recharts` — `npm install recharts`. Handles bar, line, and pie charts. Tree-shakeable. Used widely in Next.js projects. Alternative: pure Tailwind CSS bar charts (width-percentage divs) for panels where a simple relative bar is sufficient.

---

## 4. Dashboard Layout

```
/admin/analytics
══════════════════════════════════════════════════════════════════

[Panel 1]  Student Pipeline        [Panel 2]  Subscription Health
[Panel 3]  Learning Activity (30d) [Panel 4]  Assessment Health
[Panel 5]  RP Activity             [Panel 6]  Vocabulary Insights
```

Each panel is a card with a title, optional sub-title (data window), and one or more visualizations.

---

## 5. Panels — Data Sources & Queries

---

### Panel 1 — Student Pipeline (Status Funnel)

**What it shows:** Count of students at each stage of the status state machine.

**Queries:**
```sql
-- Status distribution
SELECT status, COUNT(*) as count
FROM "Child"
WHERE "archivedAt" IS NULL
GROUP BY status;

-- Archived count (sidebar)
SELECT COUNT(*) FROM "Child" WHERE "archivedAt" IS NOT NULL;

-- Registrations this month
SELECT COUNT(*) FROM "Child"
WHERE "createdAt" >= date_trunc('month', now());
```

**Visualization:** Horizontal step funnel showing:
```
pending_payment [N] → approved_pending_login [N] → assessment_required [N]
→ pending_level_review [N] → active [N]
                                              Archived: [N]  New this month: [N]
```

**Prisma equivalent:** `prisma.child.groupBy({ by: ['status'], _count: true })`

---

### Panel 2 — Subscription Health

**What it shows:** Real-time subscription state across all active students.

**Queries:**
```sql
-- Active (not expired)
SELECT COUNT(*) FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL
  AND ("subscriptionExpiresAt" IS NULL OR "subscriptionExpiresAt" > now());

-- Expiring within 7 days (renewal window)
SELECT COUNT(*) FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL
  AND "subscriptionExpiresAt" BETWEEN now() AND now() + INTERVAL '7 days';

-- In grace period (expired but within grace)
-- gracePeriodDays comes from BillingConfig; use 7 as default if no config row
SELECT COUNT(*) FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL
  AND "subscriptionExpiresAt" < now()
  AND "subscriptionExpiresAt" > now() - INTERVAL '7 days';

-- Hard locked (expired beyond grace)
SELECT COUNT(*) FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL
  AND "subscriptionExpiresAt" < now() - INTERVAL '7 days';

-- Grandfathered (null expiry, active)
SELECT COUNT(*) FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL
  AND "subscriptionExpiresAt" IS NULL;

-- Pending renewals
SELECT COUNT(*) FROM "RenewalPayment" WHERE status = 'pending';

-- Renewals approved this month
SELECT COUNT(*) FROM "RenewalPayment"
WHERE status = 'approved'
  AND "reviewedAt" >= date_trunc('month', now());
```

**Visualization:** Status pills (colored count badges):
- Green: Active
- Amber: Expiring soon / Grace period
- Red: Hard locked
- Gray: Grandfathered
- Blue: Pending renewals (action required)

---

### Panel 3 — Learning Activity (Last 30 Days)

**What it shows:** Task completion trend + skill breakdown.

**Queries:**
```sql
-- Daily completions (last 30 days)
SELECT DATE("submittedAt") as day, COUNT(*) as completions
FROM "DailySubmission"
WHERE "isCompleted" = true
  AND "submittedAt" >= now() - INTERVAL '30 days'
GROUP BY DATE("submittedAt")
ORDER BY day;

-- Completions by skill (last 30 days)
SELECT a.skill, COUNT(*) as count
FROM "DailySubmissionArtifact" a
JOIN "DailySubmission" s ON a."dailySubmissionId" = s.id
WHERE s."isCompleted" = true
  AND s."submittedAt" >= now() - INTERVAL '30 days'
GROUP BY a.skill;

-- Active students by level (current snapshot)
SELECT level, COUNT(*) as count
FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL AND level IS NOT NULL
GROUP BY level;

-- Inactive active students (no submission in 7+ days)
SELECT COUNT(*) FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL
  AND ("lastDailySubmissionAt" IS NULL
       OR "lastDailySubmissionAt" < now() - INTERVAL '7 days');
```

**Visualizations:**
- Line chart: daily completions (30 days)
- Horizontal bar: skill breakdown (reading / listening / writing / speaking)
- Bar chart: active students per literacy level (foundational / functional / transitional / advanced)
- Stat card: inactive students count with link to `/admin/inactive-students`

---

### Panel 4 — Assessment Health

**What it shows:** Pending reviews, level assignment pipeline.

**Queries:**
```sql
-- Pending initial reviews (submitted, not yet assigned a level)
SELECT COUNT(*) FROM "Assessment"
WHERE kind = 'initial' AND "submittedAt" IS NOT NULL AND "assignedLevel" IS NULL;

-- Pending periodic reviews
SELECT COUNT(*) FROM "Assessment"
WHERE kind = 'periodic' AND "submittedAt" IS NOT NULL AND "assignedLevel" IS NULL AND "isLatest" = true;

-- Level distribution (assigned levels across all active students)
SELECT level, COUNT(*) as count
FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL AND level IS NOT NULL
GROUP BY level;

-- Average days from registration to level assignment
SELECT AVG(EXTRACT(EPOCH FROM ("levelAssignedAt" - "createdAt")) / 86400) as avg_days
FROM "Child"
WHERE "levelAssignedAt" IS NOT NULL;
```

**Visualizations:**
- Stat cards: pending initial reviews, pending periodic reviews (with links to `/admin/assessments`)
- Bar chart: student count per level
- Stat: average placement time in days

---

### Panel 5 — RP (Reward Points) Activity

**What it shows:** Points economy health.

**Queries:**
```sql
-- RP distributed this week
SELECT SUM(delta) FROM "RpEvent"
WHERE "createdAt" >= date_trunc('week', now());

-- RP distributed this month
SELECT SUM(delta) FROM "RpEvent"
WHERE "createdAt" >= date_trunc('month', now());

-- Weekly RP trend (last 8 weeks)
SELECT date_trunc('week', "createdAt") as week, SUM(delta) as total
FROM "RpEvent"
GROUP BY week
ORDER BY week DESC
LIMIT 8;

-- Top 10 earners (all time, via DailySubmission.rpEarned)
SELECT c.id, c."firstName", c."lastName", SUM(s."rpEarned") as total_rp
FROM "DailySubmission" s
JOIN "Child" c ON s."childId" = c.id
GROUP BY c.id, c."firstName", c."lastName"
ORDER BY total_rp DESC
LIMIT 10;
```

**Visualizations:**
- Stat cards: RP this week, RP this month
- Line/bar chart: weekly RP trend (8 weeks)
- Leaderboard list: top 10 earners (name + RP total)

---

### Panel 6 — Vocabulary Insights

**What it shows:** Which words students are struggling with and engagement with the words feature.

**Queries:**
```sql
-- Top 20 most saved words (all students, all time)
SELECT word, COUNT(*) as saves
FROM "UnknownWord"
GROUP BY word
ORDER BY saves DESC
LIMIT 20;

-- Words saved per day (last 30 days)
SELECT DATE("createdAt") as day, COUNT(*) as saves
FROM "UnknownWord"
WHERE "createdAt" >= now() - INTERVAL '30 days'
GROUP BY DATE("createdAt")
ORDER BY day;

-- Source breakdown
SELECT source, COUNT(*) as count
FROM "UnknownWord"
GROUP BY source;

-- Students who have never saved a word (engagement gap)
SELECT COUNT(*) FROM "Child"
WHERE status = 'active' AND "archivedAt" IS NULL
  AND id NOT IN (SELECT DISTINCT "childId" FROM "UnknownWord");
```

**Visualizations:**
- Word frequency: horizontal bar list of top 20 words
- Line chart: saves per day (30 days)
- Pie/stat: source breakdown (assessment / daily_task / manual)
- Stat: students with zero saved words (engagement gap)

---

## 6. API Response Shape

```ts
type AnalyticsResponse = {
  pipeline: {
    byStatus: Record<AccountStatus, number>;
    archived: number;
    newThisMonth: number;
  };
  subscription: {
    active: number;
    expiringSoon: number;
    gracePeriod: number;
    hardLocked: number;
    grandfathered: number;
    pendingRenewals: number;
    renewalsApprovedThisMonth: number;
  };
  activity: {
    dailyCompletions: Array<{ day: string; completions: number }>;  // last 30 days
    bySkill: Record<SkillType, number>;
    byLevel: Record<LiteracyLevel, number>;
    inactiveCount: number;
  };
  assessments: {
    pendingInitial: number;
    pendingPeriodic: number;
    byLevel: Record<LiteracyLevel, number>;
    avgDaysToPlacement: number | null;
  };
  rp: {
    thisWeek: number;
    thisMonth: number;
    weeklyTrend: Array<{ week: string; total: number }>;
    topEarners: Array<{ childId: string; name: string; totalRp: number }>;
  };
  vocabulary: {
    topWords: Array<{ word: string; saves: number }>;
    savesPerDay: Array<{ day: string; saves: number }>;
    bySource: Record<UnknownWordSource, number>;
    studentsWithNoWords: number;
  };
  generatedAt: string;  // ISO timestamp — shown in UI as "Last updated X"
};
```

---

## 7. Future Panels (require schema additions)

These panels are not buildable from the current schema. Listed here so the schema additions can be considered when planning future migrations.

| Panel | Missing data | Schema addition needed |
|---|---|---|
| Time-on-task per skill | No task open/start timestamp | `DailySubmission.openedAt DateTime?` |
| Listening comprehension score trend | Scoring is client-side only | Server-side answer scoring or `DailySubmissionArtifact.score Int?` |
| Writing quality pass rate | No admin pass/fail on daily review | `DailyReview.passed Boolean?` (note: no `DailyReview` model currently exists) |
| Assessment attempt count distribution | Sessions counted but not attempted vs skipped | Already derivable from `Assessment.sessionNumber` — no new field |
| Content item usage frequency | Which content items are used most | Derivable from `AssessmentDefaultContent` + `DailyTaskContent` — no new field |

---

## 8. Implementation Order

1. Add `GET /api/admin/analytics` route (use `$queryRaw` for complex aggregates)
2. Create `app/admin/analytics/` directory + `page.tsx`
3. Add "Analytics" link to admin nav (`app/admin/page.tsx` or shared nav component)
4. `npm install recharts` — add line and bar chart components
5. Build panels in order: Pipeline → Subscription → Activity → Assessments → RP → Vocabulary
6. Add `Cache-Control: s-maxage=900` header to analytics route response

---

## 9. Invariants

- Analytics route is read-only — no mutations, no side effects
- Never expose student PII (full name, email) in aggregate panels — leaderboard uses first name + last initial only
- Cache must be short enough to remain useful (≤ 15 minutes) — do not cache for hours
- All queries must be guarded against division-by-zero (e.g., `avgDaysToPlacement` returns null if no students have been placed)
