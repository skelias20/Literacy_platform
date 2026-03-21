// lib/parseBody.ts
// Shared input validation helper for API route handlers.
//
// Usage:
//   const parsed = parseBody(MySchema, await req.json())
//   if (!parsed.ok) return parsed.response
//   const body = parsed.data  // fully typed, trusted
//
// Error details are logged server-side only.
// The client receives a generic "Invalid request data." message — never
// raw Zod issue paths, which could leak internal field names.

import { ZodSchema } from "zod";
import { NextResponse } from "next/server";

type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: ReturnType<typeof NextResponse.json> };

export function parseBody<T>(
  schema: ZodSchema<T>,
  data: unknown,
  logContext?: string
): ParseResult<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const context = logContext ? `[${logContext}]` : "[parseBody]";
    console.warn(`${context} validation failed`, result.error.issues);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid request data." },
        { status: 400 }
      ),
    };
  }
  return { ok: true, data: result.data };
}