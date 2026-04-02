// lib/schemas.ts
// Shared Zod schemas for domain types used across multiple API routes.
// Import from here instead of redeclaring in each route file.

import { z } from "zod";

// Literacy levels — matches the LiteracyLevel enum in Prisma schema
export const LiteracyLevelSchema = z.enum([
  "foundational",
  "functional",
  "transitional",
  "advanced",
] as const);

export type LiteracyLevel = z.infer<typeof LiteracyLevelSchema>;

// Assessment skills — matches the SkillType enum in Prisma schema
export const SkillSchema = z.enum([
  "reading",
  "listening",
  "writing",
  "speaking",
] as const);

export type Skill = z.infer<typeof SkillSchema>;

// UUID-like ID — used for any assessmentId, taskId, fileId etc.
// Accepts any non-empty string up to 128 chars — avoids over-constraining
// to a specific UUID format in case IDs change shape in future.
export const IdSchema = z.string().min(1).max(128).trim();

// Unknown word vocabulary — source of where the student encountered the word
export const UnknownWordSourceSchema = z.enum([
  "assessment",
  "daily_task",
  "manual",
] as const);

export type UnknownWordSource = z.infer<typeof UnknownWordSourceSchema>;

// POST /api/student/unknown-words body
// word is normalised to lowercase trimmed string before storage
export const AddUnknownWordSchema = z.object({
  word: z
    .string()
    .min(1, { error: "Word is required." })
    .max(100, { error: "Word must be 100 characters or fewer." })
    .transform((w) => w.trim().toLowerCase()),
  source: UnknownWordSourceSchema,
  note: z.string().max(500).optional(),
});