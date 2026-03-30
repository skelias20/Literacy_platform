# R2 Cloud Storage Reference

## Configuration

Provider: Cloudflare R2 (S3-compatible).
Bucket: **PRIVATE** — no public access ever.
SDK: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
Source of truth: `lib/r2.ts` — all R2 operations go through this file.

**Critical AWS SDK config:**
```ts
requestChecksumCalculation: 'WHEN_REQUIRED'
responseChecksumValidation: 'WHEN_REQUIRED'
```
These must remain. They prevent browser `fetch()` from being blocked by `x-amz-checksum-crc32` headers.

---

## Three-Step Upload Flow (NEVER revert to server buffering)

### Step 1 — Presign
```
POST /api/upload/presign
Body: { context, mimeType, byteSize, originalName, ...context-specific fields }
```
Server: validates auth (context-aware), validates constraints, creates `PENDING` File record, generates presigned PUT URL.
Returns: `{ presignedUrl, fileId }`

### Step 2 — Direct R2 PUT
```js
await fetch(presignedUrl, {
  method: "PUT",
  headers: { "Content-Type": mimeType },  // Content-Type ONLY
  body: blob
})
```
**NEVER include `Content-Length` header. NEVER include checksum headers. Server never touches the bytes.**

### Step 3 — Confirm
```
POST /api/upload/confirm
Body: { fileId, context, ...linking fields }
```
Server: idempotent check (if already COMPLETED, skip to linking), `r2ObjectExists()` verify, mark COMPLETED, link artifact.

### Worker Path (parallel)
R2 fires event → Cloudflare Queue → Worker → `POST /api/internal/r2-webhook` → marks COMPLETED.
Both paths are idempotent — last-write-wins on status is safe.

---

## R2 Key Structure

| Context | Key Pattern |
|---------|------------|
| Receipt (after child created) | `receipts/{childId}/{fileId}.{ext}` |
| Receipt (before child, temp) | `temp/{fileId}.{ext}` |
| Assessment audio | `assessments/{childId}/{skill}/{fileId}.{ext}` |
| Daily task audio | `daily/{childId}/{taskId}/{skill}/{fileId}.{ext}` |
| Admin content | `content/{adminId}/{fileId}.{ext}` |

Keys are immutable after upload. Never rename or move uploaded files.

---

## Upload Constraints

| Context | Accepted MIME types | Max size |
|---------|--------------------| ---------|
| receipt | image/jpeg, image/png, image/webp, application/pdf | 5MB |
| assessment_audio | audio/webm, audio/mpeg | 10MB |
| daily_audio | audio/webm, audio/mpeg | 10MB |
| admin_content | application/pdf, audio/mpeg | 50MB |

---

## File Serving — Private Bucket Rules

**Never expose raw R2 URLs to students.** All file serving goes through API routes:

| Route | Use | URL validity |
|-------|-----|-------------|
| `/api/admin/files/[id]` | Admin downloads any file | 300s presigned GET |
| `/api/admin/receipts/[fileId]` | Receipt viewing | 60s presigned GET |
| `/api/student/content/[fileId]` | Student content access | 300s presigned GET |

`ContentItem.assetUrl` is stored as `/api/student/content/{fileId}` at creation time — not a raw R2 URL.
Admin preview uses `/api/admin/files/{fileId}` directly.

---

## CORS Configuration (Required for Browser Uploads)

```json
[{
  "AllowedOrigins": ["http://localhost:3000", "https://your-app.vercel.app"],
  "AllowedMethods": ["PUT", "GET", "HEAD"],
  "AllowedHeaders": ["Content-Type"],
  "MaxAgeSeconds": 3600
}]
```

---

## Orphan Cleanup

PENDING File records older than 24h are cleaned up by the Cloudflare Worker cron (2am UTC daily):
- Calls `DELETE /api/internal/orphan-sweep` (validates `WORKER_SECRET` header)
- Deletes object from R2
- Marks File record as FAILED

This replaces R2 Lifecycle Rules. No Lifecycle Rules needed.

---

## Worker Infrastructure

File: `worker/src/index.ts`

Two handlers:
1. **Queue consumer** — receives R2 event notifications, calls r2-webhook to mark files COMPLETED
2. **Cron trigger** (2am UTC) — calls orphan-sweep

Internal routes validate `WORKER_SECRET` header — not JWT.

Worker is only testable after Vercel deployment. Localhost is not reachable by the Worker.

---

## Common R2 Errors

| Error | Cause | Fix |
|-------|-------|-----|
| 400 from R2 on PUT | Checksum header sent | Remove `ContentLength` from `PutObjectCommand`. Do not include `Content-Length` in client PUT headers. |
| 403 on presign | Rate limiter / wrong cookie / stale JWT | See auth.md |
| File shows PENDING forever | Worker not deployed or webhook unreachable | In dev: call confirm manually; in prod: check Worker logs |
| Objects not cleaning up | Worker not deployed | No action in dev — dev bucket accumulates PENDING objects; production uses cron |
