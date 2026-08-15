// Extracts a schema.org Recipe object from a page's raw HTML. Most recipe
// blogs (WP Recipe Maker, Tasty Recipes, Yoast, etc.) embed this as
// <script type="application/ld+json">; it's the one format worth supporting
// for v1 since it's structured and near-universal on recipe sites — pages
// without it (or using only legacy microdata) aren't supported yet.

export interface RawRecipeJsonLd {
  name?: string
  image?: unknown
  author?: unknown
  recipeYield?: unknown
  totalTime?: string
  description?: string
  recipeIngredient?: string[]
  recipeInstructions?: unknown
  [key: string]: unknown
}

export interface ParsedPage {
  jsonLd: RawRecipeJsonLd
  // Every node in the page's @graph indexed by @id, so `"image": {"@id": "…"}`
  // references (Yoast's default output) can be followed to the real ImageObject.
  graphById: Map<string, unknown>
  doc: Document
}

// Sites that entity-encode their JSON-LD text (common on WordPress recipe
// plugins) leave literal &#8217;/&amp;/etc. behind: a <script> tag's content
// is never HTML-entity-decoded by the browser's HTML parser (script data is
// raw text, not parsed as markup), and JSON.parse doesn't know about HTML
// entities either — so without this, that text passes straight through.
// Round-tripping through a detached <textarea> reuses the browser's own
// entity table instead of hand-maintaining one.
export function decodeHtmlEntities(text: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = text
  return el.value
}

// JSON-LD string fields aren't reliably strings: sites emit {"@value": "…"},
// {name: "…"}, or an array of either. Anything else stringifies to
// "[object Object]" downstream, which is how a title ends up looking broken.
export function coerceString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = coerceString(item)
      if (found) return found
    }
    return ''
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj['@value'] === 'string') return obj['@value']
    if (typeof obj.name === 'string') return obj.name
  }
  return ''
}

// The single normalizer every user-visible scraped string goes through.
export function cleanText(value: unknown): string {
  const raw = coerceString(value)
  if (!raw) return ''

  // WordPress plugins routinely double-encode (&amp;#8217;), so one decode pass
  // leaves a literal "&#8217;" on screen. Loop until stable, capped so a string
  // that legitimately contains "&amp;" can't ping-pong forever.
  let decoded = raw
  for (let i = 0; i < 3; i += 1) {
    const next = decodeHtmlEntities(decoded)
    if (next === decoded) break
    decoded = next
  }

  // Markup survives inside name/description on plenty of sites (<em>, <a>).
  // DOMParser doesn't execute anything, and we only read textContent back out.
  const stripped = new DOMParser().parseFromString(decoded, 'text/html').body.textContent ?? ''

  // JS \s already covers NBSP, U+2007, U+202F and the BOM. U+200B (zero-width
  // space) is the one blank-looking character it misses.
  return stripped.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
}

function isRecipeType(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const type = (node as Record<string, unknown>)['@type']
  if (typeof type === 'string') return type === 'Recipe'
  if (Array.isArray(type)) return type.includes('Recipe')
  return false
}

function collectCandidates(node: unknown, out: unknown[], graphById: Map<string, unknown>) {
  if (Array.isArray(node)) {
    for (const item of node) collectCandidates(item, out, graphById)
    return
  }
  if (!node || typeof node !== 'object') return

  const obj = node as Record<string, unknown>
  const id = obj['@id']
  if (typeof id === 'string' && !graphById.has(id)) graphById.set(id, node)

  if (isRecipeType(node)) out.push(node)
  if (obj['@graph']) collectCandidates(obj['@graph'], out, graphById)
}

// Roundup posts ("30 Best Vegan Dinners") and embedded related-recipe cards put
// several Recipe nodes on one page. Taking the first in document order is how an
// import ends up with a different recipe's title *and* photo, so prefer the node
// the page actually declares itself to be about.
function scoreCandidate(node: unknown, sourceUrl: string): number {
  if (!node || typeof node !== 'object') return -1
  const obj = node as Record<string, unknown>
  let score = 0

  const canonical = [obj['@id'], (obj.mainEntityOfPage as Record<string, unknown>)?.['@id'], obj.mainEntityOfPage]
    .map((v) => coerceString(v))
    .filter(Boolean)
  const bare = sourceUrl.split('#')[0].replace(/\/$/, '')
  if (canonical.some((url) => url.split('#')[0].replace(/\/$/, '') === bare)) score += 1000

  // Otherwise the fullest node is the best guess at the page's main recipe.
  if (Array.isArray(obj.recipeIngredient)) score += obj.recipeIngredient.length
  return score
}

export function parseRecipePage(html: string, sourceUrl: string): ParsedPage | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
  const candidates: unknown[] = []
  const graphById = new Map<string, unknown>()

  for (const script of scripts) {
    const text = script.textContent
    if (!text) continue
    try {
      collectCandidates(JSON.parse(text), candidates, graphById)
    } catch {
      // Malformed JSON-LD is common enough (trailing commas, HTML-escaped
      // quotes) that skipping the block is preferable to failing the import.
    }
  }

  if (candidates.length === 0) return null

  const best = candidates.reduce((a, b) =>
    scoreCandidate(b, sourceUrl) > scoreCandidate(a, sourceUrl) ? b : a,
  )
  return { jsonLd: best as RawRecipeJsonLd, graphById, doc }
}

interface ImageCandidate {
  url: string
  width: number
}

// Reject the things that are technically in an `image` field but are never the
// hero shot: tracking pixels, inline spacers, and site chrome.
function isUsableImageUrl(url: string): boolean {
  if (!url || url.startsWith('data:')) return false
  const lower = url.toLowerCase()
  if (/\.svg(\?|$)/.test(lower)) return false
  return !/(logo|icon|avatar|gravatar|sprite|placeholder|spacer)/.test(lower)
}

function collectImageCandidates(
  image: unknown,
  graphById: Map<string, unknown>,
  seen: Set<unknown>,
): ImageCandidate[] {
  if (!image) return []

  if (typeof image === 'string') {
    const ref = graphById.get(image)
    if (ref && !seen.has(ref)) {
      seen.add(ref)
      return collectImageCandidates(ref, graphById, seen)
    }
    return [{ url: image, width: 0 }]
  }

  if (Array.isArray(image)) return image.flatMap((item) => collectImageCandidates(item, graphById, seen))

  if (typeof image === 'object') {
    const obj = image as Record<string, unknown>

    // Yoast emits {"@id": "…#primaryimage"} with no url of its own; the real
    // ImageObject is a sibling node in the @graph.
    if (!obj.url && !obj.contentUrl && typeof obj['@id'] === 'string') {
      const ref = graphById.get(obj['@id'])
      if (ref && ref !== image && !seen.has(ref)) {
        seen.add(ref)
        return collectImageCandidates(ref, graphById, seen)
      }
    }

    const url = coerceString(obj.contentUrl) || coerceString(obj.url)
    if (!url) return []
    return [{ url, width: Number(coerceString(obj.width)) || 0 }]
  }

  return []
}

// Arrays here are usually Google's recommended 1:1 / 4:3 / 16:9 crop set, but
// some sites put a thumbnail first — so pick by declared width when we have it
// rather than trusting position.
export function normalizeImageUrl(image: unknown, graphById?: Map<string, unknown>): string | null {
  const usable = collectImageCandidates(image, graphById ?? new Map(), new Set()).filter((c) =>
    isUsableImageUrl(c.url),
  )
  if (usable.length === 0) return null
  return usable.reduce((a, b) => (b.width > a.width ? b : a)).url
}

function metaContent(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const content = doc.querySelector(selector)?.getAttribute('content')
    if (content && content.trim()) return content
  }
  return ''
}

// og:image is the most reliable hero on recipe blogs — worth falling back to
// whenever the JSON-LD image is missing or was filtered out as site chrome.
export function findFallbackImage(doc: Document): string | null {
  const url = metaContent(doc, ['meta[property="og:image"]', 'meta[name="twitter:image"]'])
  return url && isUsableImageUrl(url) ? url : null
}

// "Vegan Cannoli - Steph Sunshine" / "Vegan Cannoli | Recipe Blog". Only applied
// to the <title> fallback, where the site name is near-universal; separators are
// matched with surrounding spaces so hyphenated dish names survive.
function stripSiteSuffix(title: string): string {
  const parts = title.split(/\s+[|–—]\s+|\s+-\s+/)
  if (parts.length < 2) return title
  const last = parts[parts.length - 1]
  if (last.length > 40) return title
  return parts.slice(0, -1).join(' - ').trim() || title
}

function titleFromSlug(sourceUrl: string): string {
  try {
    const slug = new URL(sourceUrl).pathname.split('/').filter(Boolean).pop() ?? ''
    return slug
      .replace(/\.\w+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim()
  } catch {
    return ''
  }
}

// A missing JSON-LD `name` used to abort the whole import even though the page
// clearly names the recipe in three other places.
export function findFallbackTitle(doc: Document, sourceUrl: string): string {
  const og = cleanText(metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']))
  if (og) return og

  const h1 = cleanText(doc.querySelector('h1')?.textContent ?? '')
  if (h1) return h1

  const docTitle = cleanText(doc.querySelector('title')?.textContent ?? '')
  if (docTitle) return stripSiteSuffix(docTitle)

  return titleFromSlug(sourceUrl)
}

export function normalizeAuthors(author: unknown): string[] {
  if (!author) return []
  if (Array.isArray(author)) return author.flatMap(normalizeAuthors)
  const name = cleanText(author)
  return name ? [name] : []
}

export function normalizeServings(recipeYield: unknown): { servings: number | null; servingsText: string | null } {
  const str = cleanText(Array.isArray(recipeYield) ? recipeYield[0] : recipeYield)
  if (!str) return { servings: null, servingsText: null }
  const match = str.match(/\d+/)
  return { servings: match ? Number(match[0]) : null, servingsText: str }
}

// "PT1H15M" -> "1 hr 15 min". Duration-only fields (no date part) are all
// recipe sites ever emit for prep/cook/total time.
export function formatIsoDuration(duration: string | undefined): string | null {
  if (!duration) return null
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/)
  if (!match) return null
  const hours = match[1] ? Number(match[1]) : 0
  const minutes = match[2] ? Number(match[2]) : 0
  if (!hours && !minutes) return null
  const parts: string[] = []
  if (hours) parts.push(`${hours} hr`)
  if (minutes) parts.push(`${minutes} min`)
  return parts.join(' ')
}

function flattenInstructions(node: unknown): string[] {
  if (!node) return []
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(flattenInstructions)
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if (Array.isArray(obj.itemListElement)) return flattenInstructions(obj.itemListElement)
    if (typeof obj.text === 'string') return [obj.text]
    if (typeof obj.name === 'string') return [obj.name]
  }
  return []
}

// A site that emits recipeInstructions as one HTML blob would otherwise render
// as a single step with literal <p> tags in it.
function splitInstructionBlob(text: string): string[] {
  return text
    .split(/<\/p>|<br\s*\/?>|\r?\n/i)
    .map((part) => cleanText(part))
    .filter(Boolean)
}

export function normalizeInstructions(recipeInstructions: unknown): string[] {
  return flattenInstructions(recipeInstructions)
    .flatMap(splitInstructionBlob)
    .filter(Boolean)
}
