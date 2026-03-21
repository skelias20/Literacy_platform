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