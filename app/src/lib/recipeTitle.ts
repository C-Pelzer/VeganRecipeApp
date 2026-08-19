// Titles come out of the EPUB pipeline carrying each cookbook's own
// typography. Two artifacts of that are worth correcting at load time, since
// `recipes.json` is generated and must not be hand-edited (and re-running the
// Python pipeline is a heavier lift — the books live outside the repo, at
// C:\Users\Cameron\Documents\Vegan Cookbooks):
//
//   1. ~36% of the library is ALL CAPS, because roughly half the books set
//      their recipe names that way. It's faithful to the book but makes a
//      mixed list — the catalog, a deck, the favorites list — read as though
//      half of it is shouting.
//   2. One book (La Vida Verde) names recipes in Spanish with the English
//      translation beneath, and the extractor kept only the parenthetical:
//      "(Black Beans)" rather than "Frijoles Negros (Black Beans)". The
//      Spanish name is unrecoverable without the EPUB, so the best available
//      repair is to unwrap the parentheses.
//
// Deliberately conservative: a title that already has lowercase letters in it
// is left completely alone, so correctly-cased books are never touched.

// Lowercased inside a title, but never as its first or last word.
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'n',
  'nor', 'of', 'on', 'onto', 'or', 'over', 'per', 'the', 'to', 'up', 'via',
  'vs', 'with', 'without',
])

// Words that are genuinely uppercase rather than shouted.
const KEEP_UPPERCASE = new Set([
  'BBQ', 'BLT', 'BLTS', 'TVP', 'PB', 'PBJ', 'GF', 'DIY', 'LA', 'NYC', 'USA',
  'US', 'UK', 'AM', 'PM', 'MSG', 'IPA', 'CBD', 'TLC', 'ABC', 'ABCS', 'II',
  'III', 'IV', 'VI', 'VII', 'VIII', 'IX',
])

// Uppercase the first letter and lowercase the rest, so internal apostrophes
// survive: "MANI'S" -> "Mani's", not "Mani'S".
function capitalize(word: string): string {
  return word.toLowerCase().replace(/\p{L}/u, (c) => c.toUpperCase())
}

function caseSegment(segment: string, isFirst: boolean, isLast: boolean): string {
  const bare = segment.replace(/[^\p{L}\p{N}]/gu, '')
  if (!bare) return segment
  if (KEEP_UPPERCASE.has(bare.toUpperCase())) return segment.toUpperCase()
  if (!isFirst && !isLast && SMALL_WORDS.has(bare.toLowerCase())) return segment.toLowerCase()
  return capitalize(segment)
}

// Hyphenated compounds get cased per part ("SUN-DRIED" -> "Sun-Dried"), with
// the small-word rule applying inside them too ("BETTER-FOR-YOU" ->
// "Better-for-You").
function caseToken(token: string, isFirst: boolean, isLast: boolean): string {
  // Split on any dash (hyphen, en, em) while keeping the original separator, so
  // "PEPPER–CHIVE" cases both halves rather than only the first.
  const parts = token.split(/(\p{Pd})/u)
  const wordIndexes = parts.map((p, i) => (/^\p{Pd}$/u.test(p) ? -1 : i)).filter((i) => i >= 0)
  return parts
    .map((part, i) => {
      if (/^\p{Pd}$/u.test(part)) return part
      return caseSegment(
        part,
        isFirst && i === wordIndexes[0],
        isLast && i === wordIndexes[wordIndexes.length - 1],
      )
    })
    .join('')
}

// A few books (Southern Vegan most of all) set a decorative drop-cap in its own
// span, so the extractor emits the first letter of every word split off:
// "V ANILLA Y OGURT", "C RAZY -F LUFFY B UTTERMILK". Rejoin those.
//
// The guard matters: "SMOKY CARROT LOX ON A BAGEL" has the same shape at "A
// BAGEL" but is correct English. Only titles that also contain a *consonant*
// split — which no English or Spanish single-letter word produces — are treated
// as drop-capped, which then lets the vowel splits in the same title ("S PICED
// A PPLE P IE") be rejoined too.
// A single-letter remainder is allowed so two-letter words split by the drop cap
// still rejoin ("M Y" -> "MY"). The lookbehind is what keeps that from also
// joining across an apostrophe: in "C HICK ' N P ATTIES" the "N" belongs to
// "'n", and without the guard it would glue to "P" and give "Np Atties".
const DROP_CAP = /(^|\s)(\p{Pd}?)(?<!['’]\s)(\p{Lu})\s(\p{Lu}[\p{Lu}'’]*)/gu
const CONSONANT_SPLIT = /(^|\s)\p{Pd}?[BCDFGHJKLMNPQRSTVWXZ]\s\p{Lu}{2,}/u

function rejoinDropCaps(title: string): string {
  if (!CONSONANT_SPLIT.test(title)) return title
  return title
    .replace(DROP_CAP, (_m, pre, dash, letter, rest) => `${pre}${dash}${letter}${rest}`)
    // "DINER -STYLE" -> "DINER-STYLE". A real spaced dash ("A – B") keeps its
    // trailing space and so is left alone.
    .replace(/(\p{L})\s+(\p{Pd})(\p{L})/gu, '$1$2$3')
    // "CHICK ' N" -> "CHICK 'N"
    .replace(/\s'\s+(\p{L})/gu, " '$1")
}

function isAllCaps(title: string): boolean {
  if (title !== title.toUpperCase()) return false
  return title.replace(/[^\p{L}]/gu, '').length > 3
}

function toTitleCase(title: string): string {
  const tokens = title.split(' ')
  return tokens.map((t, i) => caseToken(t, i === 0, i === tokens.length - 1)).join(' ')
}

// Unwrap only when the opening parenthesis closes on the final character, so
// "(Fake) Chicken and Leek Brunch Pies" — a real title — is left intact.
function stripWrappingParens(title: string): string {
  if (!title.startsWith('(') || !title.endsWith(')')) return title
  let depth = 0
  for (let i = 0; i < title.length; i += 1) {
    if (title[i] === '(') depth += 1
    else if (title[i] === ')') {
      depth -= 1
      if (depth === 0) return i === title.length - 1 ? title.slice(1, -1).trim() : title
    }
  }
  return title
}

export function normalizeRecipeTitle(raw: string): string {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!collapsed) return collapsed
  const stripped = stripWrappingParens(collapsed)
  const unwrapped = rejoinDropCaps(stripped)
  // A repaired drop-cap title is always re-cased: rejoining leaves shouting
  // fragments next to normal words ("DINER-STYLE Home Fries"), which the
  // all-caps check below would otherwise skip because of that trailing lowercase.
  if (unwrapped !== stripped) return toTitleCase(unwrapped)
  return isAllCaps(unwrapped) ? toTitleCase(unwrapped) : unwrapped
}

export function withNormalizedTitle<T extends { title: string }>(recipe: T): T {
  const title = normalizeRecipeTitle(recipe.title)
  return title === recipe.title ? recipe : { ...recipe, title }
}
