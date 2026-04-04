# Email Notification System
## Liberty Library Literacy Platform

> **Status:** Designed, not yet implemented. No SMS. Email-only. Free tier only.
> Read this before touching any notification code.

---

## 1. Design Principles

- **No SMS.** Parent contact phone exists on `Parent` model but is not used for notifications.
- **Email to parent only.** `Parent.email` is the recipient for all student-related events.
- **Fire-and-forget.** Emails are sent inside existing route handlers. No queue, no retry infrastructure.
- **Never block a route on email failure.** Wrap every send in try/catch — if the email fails, the route still returns 200/201.
- **No new schema for most events.** Exception: subscription expiry warning requires `Child.lastRenewalReminderAt` to prevent spam (see §4).
- **Admin actions that already exist are the natural trigger points.** No new event model needed.

---

## 2. Email Provider

**Recommended: Resend**
- Free tier: 3,000 emails/month, 100/day — no credit card required
- Package: `npm install resend`
- One env var: `RESEND_API_KEY`
- Clean API, reliable delivery, Next.js-native

**Alternative: Nodemailer + Gmail SMTP**
- Completely free; uses a Google account with an App Password
- Limit: ~500 emails/day
- No external service dependency
- Less reliable delivery (spam filters) vs Resend
- Env vars: `GMAIL_USER`, `GMAIL_APP_PASSWORD`

**Decision:** Use Resend unless there is a reason to avoid an external service. Gmail SMTP is the fallback if no account can be created.

---

## 3. Notification Events

### Event 1 — Registration Payment Approved
**Trigger:** `POST /api/admin/payments/[id]/approve`  
**Recipient:** `Payment.child.parent.email`  
**Subject:** "Your child's Liberty Library account is approved"  
**Body:** Student name, login instructions, what to expect next (assessment).  
**Schema change:** None.

---

### Event 2 — Level Assigned (Assessment Result Ready)
**Trigger:** `POST /api/admin/assessments/assign-level`  
**Recipient:** Parent email via `Assessment.child.parent.email`  
**Subject:** "Your child's literacy level has been assigned"  
**Body:** Student name, assigned level, what `active` status means, first task coming soon.  
**Schema change:** None.

---

### Event 3 — Daily Task Created (for Student's Level)
**Trigger:** `POST /api/admin/daily-tasks`  
**Recipient:** All `active`, non-archived students at `DailyTask.level` → their parent emails  
**Subject:** "A new learning task is ready for [student name]"  
**Body:** Task date, skill area, encouragement.  
**Schema change:** None.  
**Guard:** Only fire if task is for today or a future date. Do not retroactively notify for back-dated tasks.  
**Volume risk:** If many students share a level, one task creation fires N emails. Acceptable at current scale (< 100 students). Revisit if student count grows.

---

### Event 4 — Subscription Renewal Approved
**Trigger:** `POST /api/admin/subscriptions/[id]/approve`  
**Recipient:** Parent email  
**Subject:** "Subscription renewed — access extended"  
**Body:** Student name, new expiry date.  
**Schema change:** None.

---

### Event 5 — Subscription Expiry Warning (7 Days Out)
**Trigger:** Student dashboard SSR load (`app/student/page.tsx` server side OR `GET /api/student/subscription`)  
**Recipient:** Parent email  
**Condition:** `subscriptionExpiresAt` is within `renewalWindowDays` (default 7) AND `lastRenewalReminderAt` is null or more than 3 days ago  
**Subject:** "Your child's subscription expires soon — please renew"  
**Body:** Student name, expiry date, how to renew.  
**Schema change required:**

```prisma
// Add to Child model
lastRenewalReminderAt DateTime?
```

Migration name: `add_child_renewal_reminder_at`

**Logic (in dashboard route or subscription GET):**
```ts
const daysUntil = (child.subscriptionExpiresAt.getTime() - Date.now()) / 86_400_000;
const reminderAge = child.lastRenewalReminderAt
  ? (Date.now() - child.lastRenewalReminderAt.getTime()) / 86_400_000
  : Infinity;

if (daysUntil <= renewalWindowDays && reminderAge > 3) {
  // fire email — do NOT await, wrap in try/catch
  void sendRenewalReminderEmail(child).catch(console.error);
  // update lastRenewalReminderAt in background
  void prisma.child.update({ where: { id: child.id }, data: { lastRenewalReminderAt: new Date() } }).catch(console.error);
}
```

---

## 4. Schema Change Summary

Only one new field is required:

```prisma
model Child {
  // ... existing fields ...
  lastRenewalReminderAt DateTime?   // tracks last subscription expiry reminder to prevent spam
}
```

Migration name: `add_child_renewal_reminder_at`

All other events fire from existing route handlers with data already present — no additional schema.

---

## 5. Implementation Structure

Create `lib/email.ts` — the single canonical email module.

```ts
// lib/email.ts
// All email sending goes through this file.
// Never import Resend directly in route handlers.

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = "Liberty Library <notifications@yourdomain.com>";

export async function sendPaymentApprovedEmail(to: string, studentName: string): Promise<void> { ... }
export async function sendLevelAssignedEmail(to: string, studentName: string, level: string): Promise<void> { ... }
export async function sendTaskCreatedEmail(to: string, studentName: string, skill: string, taskDate: string): Promise<void> { ... }
export async function sendRenewalApprovedEmail(to: string, studentName: string, newExpiry: Date): Promise<void> { ... }
export async function sendRenewalReminderEmail(to: string, studentName: string, expiresAt: Date): Promise<void> { ... }
```

**Rule:** Route handlers call `lib/email.ts` functions. Never import `resend` directly in a route file.

---

## 6. Guard Conditions (apply to all events)

Before sending any email:
1. `parent.email` must not be null or empty
2. Student must not be `archivedAt` (skip notifications for archived accounts)
3. `NODE_ENV !== "test"` — never fire emails in Jest test runs

```ts
if (!parentEmail || child.archivedAt || process.env.NODE_ENV === "test") return;
```

---

## 7. ENV Variables Required

```env
RESEND_API_KEY=re_...
EMAIL_FROM=Liberty Library <notifications@yourdomain.com>
```

Add both to `.env.example` and `README.md`. Never commit real values.

---

## 8. Future Extensions (do not implement now)

- Admin notification: new pending payment, new renewal submission (admin dashboard already shows counts — email is low priority)
- Digest emails: weekly summary of student activity to parent
- SMS via Twilio (only if budget is available — not planned)
- Unsubscribe link (required by CAN-SPAM if sending commercial email — consult legal)

---

## 9. Scheduled Event — Daily Task Reminder

> **Status:** Designed, not implemented. Documents the full implementation plan.

### What it does

At a fixed time each day, send a reminder email to the parent of every active student who has an unsubmitted task for today and has not already completed it. Students with no task for their level today are skipped silently.

---

### Infrastructure

The platform already has a Cloudflare Worker with a cron trigger (`0 2 * * *`) that runs the orphan sweep. This is the natural home for the daily reminder — no new service is needed.

**How multi-cron works in Cloudflare Workers:**

`wrangler.toml` accepts multiple cron expressions:

```toml
[triggers]
crons = ["0 2 * * *", "0 8 * * *"]
```

The `scheduled` handler receives the matched expression in `event.cron`, allowing the worker to route to different handlers:

```ts
async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
  if (event.cron === "0 2 * * *") {
    await handleOrphanSweep(env);
  } else if (event.cron === "0 8 * * *") {
    await handleDailyReminders(env);
  }
}
```

**Pattern:** same as orphan sweep — worker calls a Next.js internal route authenticated by `x-worker-secret`. All DB logic stays in Next.js.

---

### Choosing the reminder time

The cron expression uses **UTC**. `learnersafrica.com` is likely serving students in West/East Africa:

| Region | UTC offset | 8 AM local = |
|--------|-----------|--------------|
| West Africa (WAT, e.g. Nigeria) | UTC+1 | `0 7 * * *` |
| East Africa (EAT, e.g. Kenya) | UTC+3 | `0 5 * * *` |
| Central Africa (CAT) | UTC+2 | `0 6 * * *` |

Pick the cron expression matching your primary timezone and document it. The time is not admin-configurable (Cloudflare crons are static in wrangler.toml). To change the time, redeploy the worker.

---

### New route: `POST /api/internal/daily-reminder`

Same pattern as `/api/internal/orphan-sweep`. Protected by `x-worker-secret`.

**Logic:**

```ts
// 1. Find today's tasks (using DB server time, UTC)
const now = new Date();
const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const endOfDay   = new Date(startOfDay.getTime() + 86_400_000);

const todaysTasks = await prisma.dailyTask.findMany({
  where: { taskDate: { gte: startOfDay, lt: endOfDay } },
  select: { id: true, level: true },
});

// 2. For each task, find active students at that level who have NOT completed it
for (const task of todaysTasks) {
  const children = await prisma.child.findMany({
    where: {
      status: "active",
      archivedAt: null,
      level: task.level,
      // subscription check: null = grandfathered, otherwise must not be expired
      OR: [
        { subscriptionExpiresAt: null },
        { subscriptionExpiresAt: { gt: now } },
      ],
      NOT: {
        dailySubmissions: {
          some: { dailyTaskId: task.id, isCompleted: true },
        },
      },
    },
    select: {
      childFirstName: true,
      childLastName: true,
      archivedAt: true,
      parent: { select: { email: true } },
    },
  });

  for (const child of children) {
    void sendDailyTaskReminderEmail(
      child.parent.email,
      `${child.childFirstName} ${child.childLastName}`
    ).catch(console.error);
  }
}

return NextResponse.json({ ok: true, reminded: totalCount });
```

**Key design decisions:**
- Stateless — no new schema column needed. Whether a student has completed today's task is already tracked in `DailySubmission.isCompleted`.
- `NOT { dailySubmissions: { some: { isCompleted: true } } }` — this correctly includes students who have no submission row at all AND students with an in-progress (started but not submitted) row.
- Expired subscription students are skipped — they cannot submit, so a reminder would be misleading and potentially annoying.
- The route returns a count for worker-side logging (same as orphan sweep).

---

### New email function: `sendDailyTaskReminderEmail`

Add to `lib/email.ts`:

```ts
/**
 * Scheduled event — daily task reminder.
 * Fired from: POST /api/internal/daily-reminder (worker cron, not an admin action)
 */
export async function sendDailyTaskReminderEmail(
  to: string | null | undefined,
  studentName: string,
  archivedAt?: Date | null
): Promise<void> {
  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">Daily Task Reminder</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      <strong>${studentName}</strong> has a learning task waiting today on Liberty Library.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Please remind ${studentName} to log in and complete their daily task.
      Consistent daily practice is the most effective way to build literacy skills.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      If ${studentName} has already logged in today, please disregard this message.
    </p>
  `);

  await sendEmail(to, `Reminder: ${studentName} has a task today`, html, archivedAt);
}
```

---

### Schema changes required

**None.** The eligibility check uses existing columns:
- `Child.status = "active"`, `Child.archivedAt = null`, `Child.level`
- `Child.subscriptionExpiresAt` (already on schema)
- `DailyTask.taskDate`, `DailyTask.level`
- `DailySubmission.isCompleted`, `DailySubmission.dailyTaskId`

---

### Volume and rate considerations

- **One email per eligible student per day** — not per task (a student at a given level sees one task per day).
- At < 100 students, Resend free tier (100/day) is the binding constraint. If there are more than 100 active students, this cron will exceed the free daily limit and some emails will be rejected. Upgrade to a paid Resend plan at that point.
- The route loops synchronously over tasks but fires emails fire-and-forget. This is acceptable — the worker has a 30-second CPU time limit and email sends return quickly.
- If student count grows past ~500, batch the Prisma queries (use `take`/`skip` pagination) and await a short delay between pages.

---

### Full implementation checklist

1. Add `sendDailyTaskReminderEmail` to `lib/email.ts`
2. Create `app/api/internal/daily-reminder/route.ts` — same auth pattern as `orphan-sweep`
3. Add `handleDailyReminders` function to `worker/src/index.ts` (POST to new route)
4. Add second cron to `worker/wrangler.toml` (`"0 7 * * *"` for WAT or your chosen time)
5. Update `scheduled` handler in `worker/src/index.ts` to route by `event.cron`
6. Redeploy the worker: `cd worker && npx wrangler deploy`
7. Test manually: `npx wrangler dev` → trigger via `curl` with `x-worker-secret`

---

### What this does NOT do

- Does not send reminders for tasks the student has already started (in-progress `DailySubmission` with `isCompleted = false`) — those are still reminded, since they haven't finished.
- Does not send if there is no task for the student's level today — a student whose level has no `DailyTask` for today date gets no email.
- Does not respect individual parent notification preferences — no unsubscribe mechanism exists. Add one before enabling if commercial email law applies (CAN-SPAM, GDPR).
- Does not adapt the send time per student timezone — all students get the email at the same UTC-anchored time.

---

## 9. Implementation Order

1. Add `RESEND_API_KEY` to env + `npm install resend`
2. Schema migration: `add_child_renewal_reminder_at`
3. Create `lib/email.ts` with all five send functions
4. Wire Event 1 (payment approved) — simplest, single recipient, single route
5. Wire Event 2 (level assigned)
6. Wire Event 4 (renewal approved)
7. Wire Event 5 (expiry warning) in subscription GET route
8. Wire Event 3 (task created) — last, because it fans out to multiple recipients
