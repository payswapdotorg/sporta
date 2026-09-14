/**
 * Subject extraction (W209) — deterministic.
 *
 * Subjects come from the caller-supplied, fixture-scoped
 * {@link KnownEntityLexicon} (players + teams). Names are NEVER invented:
 * an EMPTY lexicon yields NO subjects, and unmatched words are never
 * promoted to subjects (identity resolution is W401's fusion job — a
 * commentary name is not yet an entity).
 *
 * ## Matching rules (documented exactly)
 *
 * 1. **Exact (nameConfidence 1.0)**: a whole-word, case-insensitive
 *    occurrence of a lexicon name in the containing sentence. Whole-word is
 *    checked with plain character classification (no regex construction
 *    from input — the lexicon is data, but the scan stays arithmetic:
 *    `indexOf` + boundary checks). "Salah" matches inside "Salah passes"
 *    but not inside "Salahsson".
 * 2. **Partial surname (nameConfidence 0.6)** — only for a lexicon name
 *    with NO exact occurrence in the sentence: a word token T of the
 *    sentence where T is fully contained in the name, or the name fully
 *    contained in T (case-insensitive), with the SHORTER of the two at
 *    least 4 characters. This is how a lexicon entry "K. Salah" matches
 *    the on-air surname "Salah", and how "Van Dijk" matches a bare "Dijk".
 *    The ≥ 4 rule keeps initials ("K.") and short fragments out.
 * 3. **Role** — a TEXT-ORDER heuristic, not syntax analysis (documented
 *    limitation: commentary inversions like "Great save, Alisson!" put the
 *    agent after the phrase):
 *    - mention ends at or before the event phrase starts → `"agent"`;
 *    - mention starts at or after the event phrase ends → `"patient"` IF
 *      the event type carries a patient slot — pass, save, substitution
 *      (their templates mark the "to/for" recipient: "passes to …", "comes
 *      on for …") — else `"unspecified"`;
 *    - a mention overlapping the event phrase → `"unspecified"`.
 * 4. **Dedup**: identical `(name, role)` pairs collapse to the first
 *    occurrence; different roles for the same name are both kept ("Salah
 *    passes to Salah" is an agent AND a patient). Mentions are returned in
 *    text order (ties on start broken by name — deterministic).
 *
 * Multiple mentions are allowed: commentary routinely names several players
 * around one event.
 */
import type { CommentaryEventType, SubjectMention } from "./types";

/**
 * Fixture-scoped entity vocabulary. Supplied by the CALLER — this package
 * never guesses names. An empty lexicon is valid and means no subjects.
 */
export interface KnownEntityLexicon {
  readonly players: readonly string[];
  readonly teams: readonly string[];
}

/** The documented empty lexicon — no subjects, never name guessing. */
export const EMPTY_LEXICON: KnownEntityLexicon = { players: [], teams: [] };

/**
 * Event types whose grammatical templates mark a patient slot (the
 * "to/for" recipient): a mention AFTER the event phrase of one of these
 * types is the event's patient.
 */
export const PATIENT_SLOT_EVENT_TYPES: ReadonlySet<CommentaryEventType> = new Set([
  "pass",
  "save",
  "substitution",
]);

/** Word characters for the whole-word boundary check (ECMAScript `\w`). */
const WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * Word tokens for partial-surname matching. Module-level constant — no
 * regex is ever constructed from input at runtime. Excludes sentence
 * punctuation (".", "!", ",") so "fouled." tokenizes as "fouled"; keeps
 * apostrophes and hyphens so "O'Brien" / "Van-Dijk" stay whole tokens.
 */
const WORD_TOKEN = /[A-Za-z0-9'-]+/g;

/** Lexicon names that are not usable for scanning (empty or whitespace). */
function isScannableName(name: string): boolean {
  return name.trim().length > 0;
}

/** Whole-word case-insensitive occurrences of `needle` in `sentence`. */
function findWholeWordOccurrences(
  sentence: string,
  needle: string,
): Array<{ start: number; end: number }> {
  const haystack = sentence.toLowerCase();
  const target = needle.toLowerCase();
  const occurrences: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(target, from);
    if (index === -1) break;
    const end = index + target.length;
    const beforeOk = index === 0 || !WORD_CHAR.test(sentence[index - 1] as string);
    const afterOk = end >= sentence.length || !WORD_CHAR.test(sentence[end] as string);
    if (beforeOk && afterOk) {
      occurrences.push({ start: index, end });
    }
    from = index + target.length; // non-overlapping scan, deterministic
  }
  return occurrences;
}

/** One raw mention before role assignment and dedup. */
interface RawMention {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly nameConfidence: number;
}

/** Extracts subjects from one sentence (see module docs for the rules). */
export function extractSubjects(input: {
  /** The containing sentence's text. */
  readonly sentence: string;
  /** Event phrase span, as character offsets INTO `sentence`. */
  readonly phraseStart: number;
  /** End (exclusive) of the event phrase span into `sentence`. */
  readonly phraseEnd: number;
  /** The event type — decides the patient slot (documented). */
  readonly eventType: CommentaryEventType;
  /** Fixture-scoped vocabulary; defaults to {@link EMPTY_LEXICON}. */
  readonly lexicon?: KnownEntityLexicon;
}): SubjectMention[] {
  const lexicon = input.lexicon ?? EMPTY_LEXICON;
  const sentence = input.sentence;

  const raw: RawMention[] = [];
  const names = [...lexicon.players, ...lexicon.teams].filter(isScannableName);

  for (const name of names) {
    // Rule 1: exact whole-word occurrences (1.0).
    const exact = findWholeWordOccurrences(sentence, name);
    if (exact.length > 0) {
      for (const occurrence of exact) {
        raw.push({
          name: sentence.slice(occurrence.start, occurrence.end),
          ...occurrence,
          nameConfidence: 1,
        });
      }
      continue; // a name with an exact match never also partial-matches
    }
    // Rule 2: partial-surname tokens (0.6), only when no exact match.
    const loweredName = name.toLowerCase();
    for (const token of sentence.matchAll(WORD_TOKEN)) {
      const text = token[0] as string;
      if (text.length < 4 || loweredName.length < 4) continue; // shorter side ≥ 4 chars
      const loweredToken = text.toLowerCase();
      if (loweredToken === loweredName) continue; // would have been exact
      const contained = loweredName.includes(loweredToken) || loweredToken.includes(loweredName);
      if (contained && token.index !== undefined) {
        raw.push({
          name: text,
          start: token.index,
          end: token.index + text.length,
          nameConfidence: 0.6,
        });
      }
    }
  }

  // Rule 3: roles by text order (documented heuristic), keeping each
  // mention's start for the text-order sort.
  const hasPatientSlot = PATIENT_SLOT_EVENT_TYPES.has(input.eventType);
  const roled: Array<{ mention: SubjectMention; start: number }> = raw.map((mention) => {
    let role: SubjectMention["role"];
    if (mention.end <= input.phraseStart) {
      role = "agent";
    } else if (mention.start >= input.phraseEnd) {
      role = hasPatientSlot ? "patient" : "unspecified";
    } else {
      role = "unspecified"; // overlaps the event phrase
    }
    return {
      mention: { name: mention.name, role, nameConfidence: mention.nameConfidence },
      start: mention.start,
    };
  });

  // Rule 4: text order (start, then name — deterministic), then dedupe
  // (name, role) keeping the first occurrence.
  roled.sort((a, b) => a.start - b.start || (a.mention.name < b.mention.name ? -1 : 1));
  const seen = new Set<string>();
  const out: SubjectMention[] = [];
  for (const { mention } of roled) {
    const key = `${mention.name}\u0000${mention.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mention);
  }
  return out;
}
