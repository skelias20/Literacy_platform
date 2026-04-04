# Local Dictionary System
## Liberty Library Literacy Platform

> **Status:** Designed, not yet implemented.
> Read this before touching any dictionary or unknown-words definition code.

---

## 1. Decision: Option B — WordNet + CMUdict

**Rejected:**
- Option A (CMUdict only): no definitions — not useful alone for students
- Option C (Wiktionary): 300 MB – 1.5 GB after parsing — exceeds Supabase free tier (500 MB total)

**Chosen: WordNet + CMUdict**

| Property | Value |
|---|---|
| Unique word forms | ~160,000 |
| Storage in Postgres (data + btree index) | ~120–180 MB |
| Supabase free tier impact | ~25–35% of 500 MB limit |
| Lookup latency (indexed PK) | < 1 ms |
| Definition quality | Structured, slightly formal — appropriate for literacy education |
| License | WordNet: Princeton open license. CMUdict: public domain. |

---

## 2. Schema

```prisma
model DictionaryEntry {
  word          String    @id              // lowercase, trimmed — PK is the lookup index
  pronunciation String?                   // CMUdict ARPAbet e.g. "AH0 B AE1 N D AH0 N"
                                          // comma-separated if multiple pronunciations exist
  partOfSpeech  String?                   // "noun", "verb", "adjective", "adverb"
                                          // primary POS from WordNet
  definition    String                    // primary definition (first WordNet gloss for primary POS)
  extraDefs     Json?                     // array of {pos: string, definition: string}
                                          // for words with multiple parts of speech
  createdAt     DateTime  @default(now())
}
```

**No additional `@@index` needed.** `@id` on `word` creates a unique btree index — exact-match lookups on PK are O(log n) in Postgres, sub-millisecond in practice.

**Future: full-text / substring search** — add a PostgreSQL `pg_trgm` GIN index via a raw migration if needed. Do not add this until there is a concrete use case.

Migration name: `add_dictionary_entries`

---

## 3. Optional: Cache Definition on UnknownWord

If the platform wants to display a definition inline on the words list page (without a separate lookup call), add an optional `definition` field to `UnknownWord`:

```prisma
model UnknownWord {
  // ... existing fields ...
  definition    String?   // cached from DictionaryEntry on first lookup; null until looked up
}
```

**Populate on first lookup:** When `GET /api/student/dictionary?word=X` is called and a result is found, update the `UnknownWord` row for that child+word if it exists. This means subsequent loads of the words list can show the definition without another query.

**Do NOT pre-populate at word-save time.** That would add latency to every word save. Lazy lookup only.

Migration name: `add_unknown_word_definition_cache` (separate from dictionary migration, only if this caching approach is chosen)

---

## 4. Data Source Files

### WordNet
- Download: https://wordnet.princeton.edu/download/current-version (WordNet 3.1 or 3.0)
- Relevant files: `data.noun`, `data.verb`, `data.adj`, `data.adv` in the `dict/` folder
- Format: each line = one synset; fields separated by spaces; gloss (definition) after `|`
- Parse: extract `word forms` and `gloss` per synset

### CMUdict
- Download: https://github.com/cmusphinx/cmudict (single text file)
- Format: `WORD  P1 P2 P3 ...` (one pronunciation per line, ARPAbet phonemes)
- ~134,000 entries; multiple entries for some words (WORD(1), WORD(2) for alternate pronunciations)
- Parse: take first pronunciation per word (or join alternates with `, `)

---

## 5. Import Script

Location: `scripts/import-dictionary.ts` (run once with `npx ts-node scripts/import-dictionary.ts`)

**Steps:**
1. Parse CMUdict → `Map<string, string>` (word → pronunciation)
2. Parse WordNet data files → `Map<string, { pos, definition, extraDefs[] }>`
3. Merge: for each word in WordNet, attach pronunciation from CMUdict map if present
4. Bulk insert via `prisma.dictionaryEntry.createMany({ data: [...], skipDuplicates: true })`
5. Log count of entries inserted

**Estimated run time:** 30–120 seconds depending on machine. One-time operation.

---

## 6. API Route

```
GET /api/student/dictionary?word=abandon
```

**Auth:** Student JWT required (reuse `verifyStudentJwt`).  
**Logic:**
1. Lowercase and trim the `word` query param
2. `prisma.dictionaryEntry.findUnique({ where: { word } })`
3. If found: return `{ word, pronunciation, partOfSpeech, definition, extraDefs }`
4. If not found: return `404 { error: "Word not found in dictionary" }`

**No new Zod schema needed** — `word` is a plain string query param, validated by `trim()` + length check.

---

## 7. UI Integration Points

### Words List Page (`/student/words`)
- Each word row gets a "Look up" button (or expand chevron)
- On click: `GET /api/student/dictionary?word=<word>`
- Display: definition, part of speech, pronunciation (ARPAbet rendered as-is or converted to IPA display)
- Cache result in component state so repeated expands don't re-fetch

### In-Context Word Save Panel (task and assessment pages)
- When student saves an unknown word during a task, optionally auto-lookup and show a quick definition inline
- This is a UX enhancement, not required for the save flow to work

---

## 8. IPA Rendering (optional, future)

CMUdict uses ARPAbet (e.g., `AH0 B AE1 N D AH0 N`). For a child-friendly display, this can be converted to IPA symbols client-side using a small mapping table. This is a UI-only concern — store ARPAbet in the DB, convert on display. Do not implement until there is a confirmed need.

---

## 9. Implementation Order

1. Schema migration: `add_dictionary_entries` (add `DictionaryEntry` model)
2. Download WordNet + CMUdict data files (add to `.gitignore`, do not commit raw data)
3. Write `scripts/import-dictionary.ts`
4. Run import on local → verify counts and spot-check entries
5. Apply migration + run import on production DB (Supabase)
6. Add `GET /api/student/dictionary` route
7. Wire "Look up" UI on `/student/words` page
8. (Optional) Add `definition String?` to `UnknownWord` with `add_unknown_word_definition_cache` migration
9. (Optional) Lazy-populate definition cache in the dictionary lookup route
