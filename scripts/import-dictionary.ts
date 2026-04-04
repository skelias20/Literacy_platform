// scripts/import-dictionary.ts
// One-time import of WordNet + CMUdict data into the DictionaryEntry table.
//
// Usage:
//   npm run import:dictionary
//   (or: npx tsx scripts/import-dictionary.ts)
//
// Required data files — download once, do NOT commit (covered by .gitignore):
//   scripts/data/cmudict.dict       — from https://github.com/cmusphinx/cmudict
//   scripts/data/wordnet/data.noun  — from WordNet 3.1 dict/ folder
//   scripts/data/wordnet/data.verb
//   scripts/data/wordnet/data.adj
//   scripts/data/wordnet/data.adv
//
// The script is idempotent — re-running skips duplicate words (skipDuplicates).
// Bulk-inserts in batches of 2000 rows to stay within Postgres parameter limits.

import * as fs   from "fs";
import * as path from "path";
import * as readline from "readline";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── Types ─────────────────────────────────────────────────────────────────────

type ExtraDef = { pos: string; definition: string };

type WordNetEntry = {
  pos:        string;
  definition: string;
  extraDefs:  ExtraDef[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "data");

function requireFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    console.error(`\nMissing required file: ${filePath}`);
    console.error("Please download and place the data files as described in the script header.");
    process.exit(1);
  }
}

async function readLines(filePath: string): Promise<string[]> {
  const lines: string[] = [];
  const rl = readline.createInterface({
    input:     fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    lines.push(line);
  }
  return lines;
}

// ── CMUdict parser ────────────────────────────────────────────────────────────
// Format: WORD  P1 P2 P3 ...  (two spaces between word and phonemes)
// Alternate pronunciations: WORD(1)  ..., WORD(2)  ...
// Strategy: collect all pronunciations per base word, join with ", ".

async function parseCmudict(filePath: string): Promise<Map<string, string>> {
  const map: Map<string, string[]> = new Map();
  const lines = await readLines(filePath);

  for (const line of lines) {
    // Skip comment lines
    if (line.startsWith(";;;")) continue;
    // Split on the first whitespace sequence — handles 1 space, 2 spaces, or tab
    const spaceIdx = line.search(/\s/);
    if (spaceIdx === -1) continue;

    let rawWord    = line.slice(0, spaceIdx).trim();
    const phonemes = line.slice(spaceIdx).trim();

    // Strip alternate-pronunciation suffix: WORD(1) → WORD
    rawWord = rawWord.replace(/\(\d+\)$/, "");

    const word = rawWord.toLowerCase();
    const existing = map.get(word);
    if (existing) {
      existing.push(phonemes);
    } else {
      map.set(word, [phonemes]);
    }
  }

  // Flatten: join multiple pronunciations with ", "
  const result: Map<string, string> = new Map();
  for (const [word, prons] of map) {
    result.set(word, prons.join(", "));
  }
  return result;
}

// ── WordNet parser ────────────────────────────────────────────────────────────
// Format (simplified):
//   <synset_offset> <lex_filenum> <ss_type> <w_cnt> <word1> <lex_id1> ... | <gloss>
//
// ss_type: n=noun, v=verb, a=adjective, s=adjective satellite, r=adverb
// Words in a synset share the same gloss (definition).
// We take the first gloss per word per POS. If a word appears in multiple POS,
// we store the primary (first encountered) in partOfSpeech/definition and the
// rest in extraDefs.

const POS_NAMES: Record<string, string> = {
  n: "noun",
  v: "verb",
  a: "adjective",
  s: "adjective",  // satellite adjective — treat as adjective
  r: "adverb",
};

async function parseWordNet(
  dataFiles: { filePath: string; posChar: string }[]
): Promise<Map<string, WordNetEntry>> {
  // word → { pos, definition, extraDefs[] }
  // We collect all (pos, def) pairs per word, then promote the first to primary.
  const wordDefs: Map<string, Array<{ pos: string; definition: string }>> = new Map();

  for (const { filePath, posChar } of dataFiles) {
    const posName = POS_NAMES[posChar] ?? posChar;
    const lines   = await readLines(filePath);

    for (const line of lines) {
      // Skip header lines (start with spaces or are copyright notices)
      if (line.startsWith("  ") || line.trim() === "") continue;

      // Find gloss after " | "
      const pipeIdx = line.indexOf(" | ");
      if (pipeIdx === -1) continue;

      const synsetPart = line.slice(0, pipeIdx);
      // Gloss may contain a semicolon-separated list of examples; take everything before first ";"
      const rawGloss = line.slice(pipeIdx + 3).trim();
      const gloss    = rawGloss.split(";")[0].trim();
      if (!gloss) continue;

      // Parse the synset part: fields separated by spaces
      const fields = synsetPart.split(" ");
      // fields[0] = synset_offset, fields[1] = lex_filenum, fields[2] = ss_type, fields[3] = w_cnt (hex)
      if (fields.length < 4) continue;

      const wCount = parseInt(fields[3], 16);
      // Word entries start at index 4, each word occupies 2 tokens (word + lex_id)
      for (let i = 0; i < wCount; i++) {
        const wordIdx = 4 + i * 2;
        if (wordIdx >= fields.length) break;

        // WordNet uses underscores for multi-word entries; replace with spaces or skip
        const rawWord = fields[wordIdx];
        // Skip multi-word entries (contain underscore) — single words only
        if (rawWord.includes("_")) continue;

        const word = rawWord.toLowerCase();

        const existing = wordDefs.get(word);
        if (existing) {
          // Only add this (pos, def) if we don't already have this POS recorded
          const hasPos = existing.some((e) => e.pos === posName);
          if (!hasPos) {
            existing.push({ pos: posName, definition: gloss });
          }
        } else {
          wordDefs.set(word, [{ pos: posName, definition: gloss }]);
        }
      }
    }
  }

  // Convert to WordNetEntry map
  const result: Map<string, WordNetEntry> = new Map();
  for (const [word, defs] of wordDefs) {
    const [primary, ...rest] = defs;
    result.set(word, {
      pos:        primary.pos,
      definition: primary.definition,
      extraDefs:  rest,
    });
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const cmudictPath = path.join(DATA_DIR, "cmudict.dict");
  const wordnetFiles = [
    { filePath: path.join(DATA_DIR, "wordnet", "data.noun"), posChar: "n" },
    { filePath: path.join(DATA_DIR, "wordnet", "data.verb"), posChar: "v" },
    { filePath: path.join(DATA_DIR, "wordnet", "data.adj"),  posChar: "a" },
    { filePath: path.join(DATA_DIR, "wordnet", "data.adv"),  posChar: "r" },
  ];

  // Verify all required files exist before doing any work.
  requireFile(cmudictPath);
  for (const { filePath } of wordnetFiles) requireFile(filePath);

  console.log("Parsing CMUdict...");
  const pronunciations = await parseCmudict(cmudictPath);
  console.log(`  ${pronunciations.size} CMUdict entries loaded`);

  console.log("Parsing WordNet...");
  const wordnetEntries = await parseWordNet(wordnetFiles);
  console.log(`  ${wordnetEntries.size} WordNet word forms loaded`);

  // Merge: WordNet is the source of truth for words. CMUdict adds pronunciation.
  const rows = [];
  for (const [word, entry] of wordnetEntries) {
    rows.push({
      word,
      pronunciation: pronunciations.get(word) ?? null,
      partOfSpeech:  entry.pos,
      definition:    entry.definition,
      extraDefs:     entry.extraDefs.length > 0 ? entry.extraDefs : undefined,
    });
  }

  console.log(`\nInserting ${rows.length} entries into DictionaryEntry...`);

  const BATCH_SIZE = 2000;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await prisma.dictionaryEntry.createMany({
      data:           batch,
      skipDuplicates: true,
    });
    inserted += result.count;

    const pct = Math.round(((i + batch.length) / rows.length) * 100);
    process.stdout.write(`\r  Progress: ${pct}% (${inserted} inserted)`);
  }

  console.log(`\n\nDone. ${inserted} new entries inserted (duplicates skipped).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
