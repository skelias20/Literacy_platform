// worker/src/index.ts
// Cloudflare Worker with two responsibilities:
// 1. Queue consumer: receives R2 event notifications, pings Next.js webhook
// 2. Cron trigger: daily orphan sweep — deletes PENDING files older than 24h

export interface Env {
    WORKER_SECRET: string;
    NEXT_APP_URL: string;
    // R2 bucket binding for orphan deletion
    LITERACY_BUCKET: R2Bucket;
    // Queue binding
    R2_EVENTS_QUEUE: Queue;
    // Database URL for orphan sweep (uses Hyperdrive or direct connection)
    DATABASE_URL: string;
  }
  
  // ─── R2 Event Notification message shape ──────────────────────────────────
  // Cloudflare R2 event notifications send this structure via Queue.
  interface R2EventMessage {
    account: string;
    bucket: string;
    object: {
      key: string;
      size: number;
      etag: string;
    };
    action: "PutObject" | "DeleteObject" | "CopyObject";
    eventTime: string;
  }
  
  // ─── Queue consumer ────────────────────────────────────────────────────────
  async function handleQueueMessage(
    message: R2EventMessage,
    env: Env
  ): Promise<void> {
    // Only process PutObject events (new file uploaded)
    if (message.action !== "PutObject") return;
  
    const r2Key = message.object.key;
  
    const response = await fetch(`${env.NEXT_APP_URL}/api/internal/r2-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": env.WORKER_SECRET,
      },
      body: JSON.stringify({ r2Key }),
    });
  
    if (!response.ok) {
      const text = await response.text();
      // Throw so the Queue retries this message (up to Queue retry policy)
      throw new Error(
        `Webhook failed for key ${r2Key}: ${response.status} ${text}`
      );
    }
  }
  
  // ─── Orphan sweep ──────────────────────────────────────────────────────────
  // Finds PENDING File records older than 24h and deletes them from R2.
  // We call a Next.js internal endpoint to avoid duplicating DB logic in Worker.
  async function handleOrphanSweep(env: Env): Promise<void> {
    const response = await fetch(
      `${env.NEXT_APP_URL}/api/internal/orphan-sweep`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": env.WORKER_SECRET,
        },
      }
    );
  
    if (!response.ok) {
      const text = await response.text();
      console.error(`Orphan sweep failed: ${response.status} ${text}`);
      // Don't throw — cron failures are logged, not retried like Queue messages
    } else {
      const data = (await response.json()) as { cleaned: number };
      console.log(`Orphan sweep completed. Cleaned: ${data.cleaned} files`);
    }
  }
  
  // ─── Worker export ─────────────────────────────────────────────────────────
  export default {
    // Queue consumer handler
    async queue(
      batch: MessageBatch<R2EventMessage>,
      env: Env
    ): Promise<void> {
      for (const message of batch.messages) {
        try {
          await handleQueueMessage(message.body, env);
          message.ack(); // success — remove from queue
        } catch (err) {
          console.error("Queue message failed:", err);
          message.retry(); // re-queue for retry
        }
      }
    },
  
    // Cron trigger handler (runs daily)
    async scheduled(
      _event: ScheduledEvent,
      env: Env,
      _ctx: ExecutionContext
    ): Promise<void> {
      await handleOrphanSweep(env);
    },
  };