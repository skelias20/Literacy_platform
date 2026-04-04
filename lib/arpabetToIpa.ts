// lib/arpabetToIpa.ts
// Converts a CMUdict ARPAbet string to an IPA string for display.
//
// ARPAbet vowels carry a stress digit suffix:
//   0 = no stress, 1 = primary stress, 2 = secondary stress
// IPA stress markers are placed BEFORE the stressed vowel:
//   1 → ˈ   2 → ˌ
//
// AH and ER have stress-dependent IPA values:
//   AH0 → ə  (schwa)      AH1/AH2 → ʌ  (strut)
//   ER0 → ɚ  (unstressed)  ER1/ER2 → ɝ  (stressed r-colored vowel)
//
// Multiple pronunciations separated by ", " are each converted and rejoined.
// Output is wrapped in slashes: /ɪɡˈzæmpl̩/
//
// Safe to import in client components — no server-only APIs used.

const ARPABET_IPA: Record<string, string> = {
  // Vowels
  AA: "ɑ",
  AE: "æ",
  AH: "ə",   // default; overridden for stressed forms below
  AO: "ɔ",
  AW: "aʊ",
  AY: "aɪ",
  EH: "ɛ",
  ER: "ɚ",   // default; overridden for stressed forms below
  EY: "eɪ",
  IH: "ɪ",
  IY: "i",
  OW: "oʊ",
  OY: "ɔɪ",
  UH: "ʊ",
  UW: "u",
  // Consonants
  B:  "b",
  CH: "tʃ",
  D:  "d",
  DH: "ð",
  F:  "f",
  G:  "ɡ",
  HH: "h",
  JH: "dʒ",
  K:  "k",
  L:  "l",
  M:  "m",
  N:  "n",
  NG: "ŋ",
  P:  "p",
  R:  "r",
  S:  "s",
  SH: "ʃ",
  T:  "t",
  TH: "θ",
  V:  "v",
  W:  "w",
  Y:  "j",
  Z:  "z",
  ZH: "ʒ",
};

function convertSingle(pronunciation: string): string {
  const phonemes = pronunciation.trim().split(/\s+/);
  let result = "";

  for (const phoneme of phonemes) {
    const m = phoneme.match(/^([A-Z]+)([012])$/);
    const base   = m ? m[1] : phoneme;
    const stress = m ? m[2] : null;

    // Stress marker precedes the IPA symbol for the vowel
    if (stress === "1") result += "ˈ";
    else if (stress === "2") result += "ˌ";

    // Stress-specific IPA for AH and ER
    if (base === "AH") {
      result += (stress === "1" || stress === "2") ? "ʌ" : "ə";
    } else if (base === "ER") {
      result += (stress === "1" || stress === "2") ? "ɝ" : "ɚ";
    } else {
      result += ARPABET_IPA[base] ?? base.toLowerCase();
    }
  }

  return "/" + result + "/";
}

/**
 * Converts a CMUdict ARPAbet pronunciation string to IPA.
 * Handles comma-separated alternate pronunciations.
 *
 * @example
 * arpabetToIpa("AH0 B AE1 N D AH0 N")  // → "/əˈbændən/"
 * arpabetToIpa("T EH1 S T")             // → "/ˈtɛst/"
 */
export function arpabetToIpa(arpabet: string): string {
  return arpabet
    .split(", ")
    .map(convertSingle)
    .join(", ");
}
