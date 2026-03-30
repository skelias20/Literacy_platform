// lib/wordCount.ts
// Single definition of "word" used on both client (live display) and server (submit validation).
// A word is any sequence of non-whitespace characters separated by whitespace.
// This is intentionally simple — consistent trumps sophisticated for a literacy platform.

export function countWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
  }
  
  // Normalise before saving or validating — strip leading/trailing whitespace.
  // Does NOT collapse internal whitespace — preserves the student's formatting.
  export function normaliseText(text: string): string {
    return text.trim();
  }