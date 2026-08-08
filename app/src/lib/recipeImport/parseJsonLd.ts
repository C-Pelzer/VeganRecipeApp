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

function isRecipeType(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const type = (node as Record<string, unknown>)['@type']
  if (typeof type === 'string') return type === 'Recipe'
  if (Array.isArray(type)) return type.includes('Recipe')
  return false
}

function collectCandidates(node: unknown, out: unknown[]) {
  if (Array.isArray(node)) {
    for (const item of node) collectCandidates(item, out)
    return
  }
  if (!node || typeof node !== 'object') return
  if (isRecipeType(node)) out.push(node)
  const graph = (node as Record<string, unknown>)['@graph']
  if (graph) collectCandidates(graph, out)
}

export function findRecipeJsonLd(html: string): RawRecipeJsonLd | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
  const candidates: unknown[] = []

  for (const script of scripts) {
    const text = script.textContent
    if (!text) continue
    try {
      collectCandidates(JSON.parse(text), candidates)
    } catch {
      // Malformed JSON-LD is common enough (trailing commas, HTML-escaped
      // quotes) that skipping the block is preferable to failing the import.
    }
  }

  return (candidates[0] as RawRecipeJsonLd) ?? null
}

export function normalizeImageUrl(image: unknown): string | null {
  if (!image) return null
  if (typeof image === 'string') return image
  if (Array.isArray(image)) return normalizeImageUrl(image[0])
  if (typeof image === 'object' && 'url' in (image as Record<string, unknown>)) {
    return normalizeImageUrl((image as Record<string, unknown>).url)
  }
  return null
}

export function normalizeAuthors(author: unknown): string[] {
  if (!author) return []
  if (typeof author === 'string') return [author]
  if (Array.isArray(author)) return author.flatMap(normalizeAuthors)
  if (typeof author === 'object' && 'name' in (author as Record<string, unknown>)) {
    const name = (author as Record<string, unknown>).name
    return typeof name === 'string' ? [name] : []
  }
  return []
}

export function normalizeServings(recipeYield: unknown): { servings: number | null; servingsText: string | null } {
  const text = Array.isArray(recipeYield) ? recipeYield[0] : recipeYield
  if (typeof text !== 'string' && typeof text !== 'number') return { servings: null, servingsText: null }
  const str = String(text)
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

export function normalizeInstructions(recipeInstructions: unknown): string[] {
  return flattenInstructions(recipeInstructions)
    .map((step) => step.trim())
    .filter(Boolean)
}
