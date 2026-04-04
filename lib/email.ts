// lib/email.ts
// Canonical email module — all outbound email goes through this file.
//
// Architecture: sendEmail() is the ONLY provider-aware function.
// To switch from Resend to another provider (SendGrid, Nodemailer, Postmark, etc.),
// replace sendEmail() only. Every domain function above it is provider-agnostic.
//
// Rules:
//  - Never import Resend (or any email SDK) in route handlers — only import from here.
//  - All sends are fire-and-forget: wrap call sites in void ...catch(console.error).
//  - Never await email sends in a way that can block or fail a route response.

import { Resend } from "resend";

// ─── Provider adapter (swap this block to change providers) ──────────────────

const FROM =
  process.env.EMAIL_FROM ?? "Liberty Library <notifications@learnersafrica.com>";

/**
 * Low-level email send. Handles all guards:
 *  - test environment → no-op
 *  - missing API key → warn + no-op
 *  - null/empty recipient → no-op
 *  - archived student → no-op (pass archivedAt from the caller)
 *
 * This is private — callers use the domain functions below.
 */
async function sendEmail(
  to: string | null | undefined,
  subject: string,
  html: string,
  archivedAt?: Date | null
): Promise<void> {
  if (process.env.NODE_ENV === "test") return;
  if (!to || to.trim() === "") return;
  if (archivedAt) return;

  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — email skipped:", subject);
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) console.error("[email] Send failed:", error.message, { subject, to });
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function formatLevel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function formatSkills(skills: string[]): string {
  const named = skills.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  if (named.length === 1) return named[0];
  return named.slice(0, -1).join(", ") + " & " + named[named.length - 1];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Minimal, mail-client-safe HTML wrapper. No external fonts or images. */
function wrapHtml(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Liberty Library</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:560px;">
          <tr>
            <td style="background:#1d4ed8;padding:24px 32px;">
              <p style="margin:0;font-size:20px;font-weight:bold;color:#ffffff;">Liberty Library</p>
              <p style="margin:4px 0 0;font-size:13px;color:#bfdbfe;">Literacy Learning Platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              ${bodyContent}
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#6b7280;">
                This is an automated notification from Liberty Library. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Domain send functions ────────────────────────────────────────────────────

/**
 * Event 1 — Registration payment approved.
 * Fired from: POST /api/admin/payments/[id]/approve
 */
export async function sendPaymentApprovedEmail(
  to: string | null | undefined,
  studentName: string,
  archivedAt?: Date | null
): Promise<void> {
  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">Account Approved!</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Great news! Your child <strong>${studentName}</strong>'s Liberty Library account has been approved.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      <strong>What happens next:</strong><br />
      An admin will set up login credentials for ${studentName} and share them with you shortly.
      Once logged in, ${studentName} will complete an initial literacy assessment so we can
      personalise their learning journey.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      If you have any questions, please contact your Liberty Library administrator.
    </p>
  `);

  await sendEmail(to, "Your child's Liberty Library account is approved", html, archivedAt);
}

/**
 * Event 2 — Literacy level assigned after assessment review.
 * Fired from: POST /api/admin/assessments/assign-level
 */
export async function sendLevelAssignedEmail(
  to: string | null | undefined,
  studentName: string,
  level: string,
  archivedAt?: Date | null
): Promise<void> {
  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">Assessment Complete</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      <strong>${studentName}</strong>'s assessment has been reviewed and a literacy level has been assigned.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px 20px;">
          <p style="margin:0;font-size:13px;color:#1e40af;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;">Assigned Level</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:bold;color:#1d4ed8;">${formatLevel(level)}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      ${studentName} is now <strong>active</strong> on the platform. Daily learning tasks will be assigned
      at their level — you will receive a notification each time a new task is ready.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      Keep encouraging ${studentName} — consistent practice makes all the difference!
    </p>
  `);

  await sendEmail(to, "Your child's literacy level has been assigned", html, archivedAt);
}

/**
 * Event 3 — Daily task created for a student's level.
 * Fired from: POST /api/admin/daily-tasks (fan-out, one call per eligible student)
 */
export async function sendTaskCreatedEmail(
  to: string | null | undefined,
  studentName: string,
  skills: string[],
  taskDate: string,
  archivedAt?: Date | null
): Promise<void> {
  const skillLabel = formatSkills(skills);
  const dateLabel = formatDate(new Date(`${taskDate}T00:00:00.000Z`));

  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">New Learning Task Ready</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      A new learning task has been assigned for <strong>${studentName}</strong>.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;width:100%;">
      <tr>
        <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px 20px;">
          <p style="margin:0 0 4px;font-size:13px;color:#166534;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;">Task Details</p>
          <p style="margin:0;font-size:15px;color:#15803d;"><strong>Date:</strong> ${dateLabel}</p>
          <p style="margin:4px 0 0;font-size:15px;color:#15803d;"><strong>Skill${skills.length > 1 ? "s" : ""}:</strong> ${skillLabel}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      Please remind ${studentName} to log in and complete their task. Regular practice builds strong literacy skills!
    </p>
  `);

  await sendEmail(to, `A new learning task is ready for ${studentName}`, html, archivedAt);
}

/**
 * Event 4 — Subscription renewal approved.
 * Fired from: POST /api/admin/subscriptions/[id]/approve
 */
export async function sendRenewalApprovedEmail(
  to: string | null | undefined,
  studentName: string,
  newExpiry: Date,
  archivedAt?: Date | null
): Promise<void> {
  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">Subscription Renewed</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      The subscription for <strong>${studentName}</strong> has been renewed and access has been extended.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px 20px;">
          <p style="margin:0;font-size:13px;color:#1e40af;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;">New Expiry Date</p>
          <p style="margin:4px 0 0;font-size:20px;font-weight:bold;color:#1d4ed8;">${formatDate(newExpiry)}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      Thank you for your continued support of ${studentName}'s literacy journey!
    </p>
  `);

  await sendEmail(to, "Subscription renewed — access extended", html, archivedAt);
}

/**
 * Event 5 — Subscription expiry warning (7 days before expiry).
 * Fired from: GET /api/student/subscription (SSR — fire-and-forget only)
 * Caller is responsible for the 3-day cooldown check before calling this.
 */
export async function sendRenewalReminderEmail(
  to: string | null | undefined,
  studentName: string,
  expiresAt: Date,
  archivedAt?: Date | null
): Promise<void> {
  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">Subscription Expiring Soon</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      <strong>${studentName}</strong>'s Liberty Library subscription is expiring soon.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:12px 20px;">
          <p style="margin:0;font-size:13px;color:#9a3412;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;">Expiry Date</p>
          <p style="margin:4px 0 0;font-size:20px;font-weight:bold;color:#c2410c;">${formatDate(expiresAt)}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      To keep ${studentName}'s access uninterrupted, please log in to the student portal and
      submit a renewal payment before the expiry date.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      If you have already submitted a renewal, please disregard this message.
    </p>
  `);

  await sendEmail(
    to,
    `${studentName}'s subscription expires soon — please renew`,
    html,
    archivedAt
  );
}

/**
 * Event 6 — Registration payment submitted (confirmation to parent).
 * Fired from: POST /api/register
 */
export async function sendPaymentSubmittedEmail(
  to: string | null | undefined,
  studentName: string
): Promise<void> {
  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">Registration Received</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Thank you! We have received the registration and payment for <strong>${studentName}</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      <strong>What happens next:</strong><br />
      Our team will review the payment and notify you once it has been approved.
      This typically takes 1–2 business days.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      If you have any questions, please contact your Liberty Library administrator.
    </p>
  `);

  await sendEmail(to, "We received your registration — payment under review", html);
}

/**
 * Event 7 — Registration payment rejected.
 * Fired from: POST /api/admin/payments/[id]/reject
 */
export async function sendPaymentRejectedEmail(
  to: string | null | undefined,
  studentName: string,
  reason?: string | null
): Promise<void> {
  const reasonBlock = reason
    ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        <strong>Reason:</strong> ${reason}
       </p>`
    : "";

  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">Payment Not Approved</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Unfortunately, the payment submitted for <strong>${studentName}</strong>'s Liberty Library
      registration could not be approved.
    </p>
    ${reasonBlock}
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Please contact your Liberty Library administrator for further assistance or to resubmit payment.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      We apologise for the inconvenience.
    </p>
  `);

  await sendEmail(to, "Payment not approved — Liberty Library registration", html);
}

/**
 * Event 8 — Student login credentials created.
 * Fired from: POST /api/admin/approved-users/[id]/create-credentials
 * NOTE: password is sent in plaintext — the only moment it is available.
 */
export async function sendCredentialsCreatedEmail(
  to: string | null | undefined,
  studentName: string,
  username: string,
  password: string
): Promise<void> {
  const html = wrapHtml(`
    <p style="margin:0 0 16px;font-size:16px;font-weight:bold;">Login Credentials Ready</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      <strong>${studentName}</strong>'s Liberty Library login credentials have been created.
      Please share these details with your child and keep them in a safe place.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;width:100%;">
      <tr>
        <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px 20px;">
          <p style="margin:0 0 8px;font-size:13px;color:#166534;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;">Login Details</p>
          <p style="margin:0 0 4px;font-size:15px;color:#15803d;"><strong>Username:</strong> ${username}</p>
          <p style="margin:0;font-size:15px;color:#15803d;"><strong>Password:</strong> ${password}</p>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      <strong>Important:</strong> Please note this password carefully. For security, consider
      asking your administrator to update it after first login.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Once logged in, <strong>${studentName}</strong> will complete an initial literacy assessment
      so we can personalise their learning journey.
    </p>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
      If you have any questions, please contact your Liberty Library administrator.
    </p>
  `);

  await sendEmail(to, `Login credentials ready for ${studentName}`, html);
}
