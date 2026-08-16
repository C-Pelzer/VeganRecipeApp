// @ts-nocheck — this runs in Supabase's Deno-based Edge Runtime, not this
// repo's Node/TypeScript project (it's outside app/'s tsconfig). The editor's
// TS server flags Deno's `Deno.*` globals and https:/npm: remote imports as
// errors because it has no Deno type info, not because anything is wrong.
//
// Supabase Edge Function — server-side proxy for the "import recipe from a
// URL" feature (NewIdeas.txt item #1) and post-cook photo uploads (item #3).
// Handles three things better done off a phone/browser:
//
//   1. mode "html" (default): fetch a recipe page's HTML so the app can scan
//      it for schema.org Recipe JSON-LD. Most sites don't send CORS headers,
//      so a direct browser fetch() would be blocked.
//   2. mode "image": fetch the recipe's photo, downscale it to a small JPEG,
//      and upload it to the same `recipe-images` Storage bucket the cookbook
//      pipeline uses (scripts/upload-images.mjs) — so imported recipes don't
//      hotlink the source site's image (which can disappear or block
//      hotlinking) and don't pull down a full-resolution photo on every load.
//   3. multipart upload (Content-Type: multipart/form-data): resize a
//      user-provided photo and upload it — either a manually-added recipe's
//      primary photo (kind "hero", one object per recipe) or a post-cook
//      "I made this" photo (kind "post-cook", default, one of possibly
//      several). Server-side rather than a client-side canvas resize because
//      a raw phone-camera photo decodes to 100MB+ of pixels, which crashes
//      canvas/ImageBitmap on real Android hardware ("unable to complete
//      operation because of low memory") — the browser only needs to
//      read+POST the compressed file bytes, never decode them.
//
// Deploy via the Supabase Dashboard: Edge Functions → New Function → name it
// "fetch-page" → paste this file's contents → Deploy. (Or `supabase functions
// deploy fetch-page` if you have the CLI linked to the project.) No secrets
// need to be set manually — SUPABASE_URL / SUPABASE_ANON_KEY are injected
// automatically into every Edge Function.

import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_HTML_BYTES = 5 * 1024 * 1024 // recipe blog pages are never this big
const MAX_IMAGE_BYTES = 15 * 1024 * 1024 // guard against something absurd before we even try to decode
const IMAGE_MAX_WIDTH = 700 // matches the cookbook pipeline (scripts/extract-images.mjs), so imported
// cards don't look soft next to book cards on a 3x phone screen
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // real camera JPEGs, even high-megapixel ones, land well under this
const UPLOAD_MAX_WIDTH = 1440 // a post-cook photo is a "hero" photo people look back on, not a thumbnail
const IMAGE_BUCKET = 'recipe-images'
const BLOCKED_HOSTNAMES = new Set(['localhost', '0.0.0.0', '127.0.0.1', '::1'])

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) return true
  // Basic private-range check on IP-literal hosts (10.x, 172.16-31.x, 192.168.x).
  // Not DNS-rebinding-proof, but this is a private 2-person tool, not a public service.
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true
  const private172 = hostname.match(/^172\.(\d+)\.\d+\.\d+$/)
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true
  return false
}

function parseTargetUrl(raw: unknown): URL | null {
  try {
    const url = new URL(String(raw))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (isBlockedHost(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

async function handleHtmlFetch(targetUrl: URL): Promise<Response> {
  const res = await fetch(targetUrl, {
    headers: {
      // Plenty of recipe blogs block requests without a browser-like UA.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  })
  if (!res.ok) return jsonResponse({ error: `Source site returned ${res.status}` }, 502)

  const bytes = await readCapped(res, MAX_HTML_BYTES)
  if (!bytes) return jsonResponse({ error: 'Page too large' }, 502)

  return jsonResponse({ html: new TextDecoder().decode(bytes), finalUrl: res.url })
}

// Formats every browser this app runs on can render, but ImageScript can't
// decode. Rather than fail the snapshot — which left the recipe hotlinking the
// source site, outside the PWA's offline cache — these are stored byte-for-byte.
// They're already well compressed, and MAX_IMAGE_BYTES bounds the size.
const PASSTHROUGH_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

// Content-Type headers on image CDNs are unreliable (octet-stream, or plain
// wrong), so fall back to the magic bytes.
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null
  const b = bytes
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  // RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  // ....ftyp<brand> — ISO-BMFF. AVIF rides on it, but so do MP4 and MOV, so
  // check the brand rather than storing a video as an image.
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (brand === 'avif' || brand === 'avis' || brand === 'mif1') return 'image/avif'
  }
  return null
}

async function handleImageSnapshot(targetUrl: URL, recipeId: string): Promise<Response> {
  const res = await fetch(targetUrl, {
    // Without a browser-like UA and a same-origin Referer, hotlink-protected
    // CDNs answer 403 and the recipe silently ends up with no stored photo.
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: targetUrl.origin + '/',
    },
    redirect: 'follow',
  })
  if (!res.ok) return jsonResponse({ error: `Image fetch returned ${res.status}` }, 502)

  const bytes = await readCapped(res, MAX_IMAGE_BYTES)
  if (!bytes) return jsonResponse({ error: 'Image too large' }, 502)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)

  let body: Uint8Array
  let contentType: string
  let extension: string

  try {
    const image = await Image.decode(bytes)
    if (image.width > IMAGE_MAX_WIDTH) {
      image.resize(IMAGE_MAX_WIDTH, Image.RESIZE_AUTO)
    }
    body = await image.encodeJPEG(70)
    contentType = 'image/jpeg'
    extension = 'jpg'
  } catch {
    // ImageScript handles PNG/JPEG/TIFF only. WebP and AVIF — now the default
    // from most WordPress image CDNs — land here.
    const sniffed = sniffImageType(bytes) ?? (res.headers.get('content-type') ?? '').split(';')[0].trim()
    const passthrough = PASSTHROUGH_TYPES[sniffed]
    if (!passthrough) {
      return jsonResponse({ error: `Unrecognized image format${sniffed ? ` (${sniffed})` : ''}` }, 502)
    }
    body = bytes
    contentType = sniffed
    extension = passthrough
  }

  // The extension varies, so a re-snapshot that changes format writes a new
  // object path — which also sidesteps the PWA's CacheFirst rule serving the
  // previous image forever.
  const objectPath = `${recipeId}.${extension}`
  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(objectPath, body, { contentType, upsert: true })
  if (uploadError) return jsonResponse({ error: `Upload failed: ${uploadError.message}` }, 502)

  const publicUrl = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${IMAGE_BUCKET}/${objectPath}`
  return jsonResponse({ publicUrl })
}

async function handlePhotoUpload(req: Request): Promise<Response> {
  const form = await req.formData()
  const recipeId = form.get('recipeId')
  const file = form.get('file')
  // 'hero' = the recipe's one primary photo, same single-object-per-recipe
  // convention handleImageSnapshot uses (overwritable). 'post-cook' = one of
  // possibly several "I made this" photos, each its own object.
  const kind = form.get('kind') === 'hero' ? 'hero' : 'post-cook'
  if (typeof recipeId !== 'string' || !recipeId) {
    return jsonResponse({ error: 'Upload requires a "recipeId" field' }, 400)
  }
  if (!(file instanceof File)) {
    return jsonResponse({ error: 'Upload requires a "file" field' }, 400)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: 'Photo too large' }, 413)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  let image: Image
  try {
    image = await Image.decode(bytes)
  } catch {
    return jsonResponse({ error: 'Unrecognized image format' }, 502)
  }

  if (image.width > UPLOAD_MAX_WIDTH) {
    image.resize(UPLOAD_MAX_WIDTH, Image.RESIZE_AUTO)
  }
  const jpeg = await image.encodeJPEG(82)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const objectPath =
    kind === 'hero' ? `${recipeId}.jpg` : `post-cook/${recipeId}/${crypto.randomUUID()}.jpg`
  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(objectPath, jpeg, { contentType: 'image/jpeg', upsert: kind === 'hero' })
  if (uploadError) return jsonResponse({ error: `Upload failed: ${uploadError.message}` }, 502)

  const publicUrl = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${IMAGE_BUCKET}/${objectPath}`
  return jsonResponse({ publicUrl })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST' }, 405)

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    try {
      return await handlePhotoUpload(req)
    } catch (err) {
      return jsonResponse({ error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` }, 502)
    }
  }

  let body: { url?: unknown; mode?: unknown; recipeId?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON' }, 400)
  }

  const targetUrl = parseTargetUrl(body.url)
  if (!targetUrl) return jsonResponse({ error: 'Body must include a valid, allowed "url" field' }, 400)

  try {
    if (body.mode === 'image') {
      if (typeof body.recipeId !== 'string' || !body.recipeId) {
        return jsonResponse({ error: 'Image mode requires a "recipeId" field' }, 400)
      }
      return await handleImageSnapshot(targetUrl, body.recipeId)
    }
    return await handleHtmlFetch(targetUrl)
  } catch (err) {
    return jsonResponse({ error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` }, 502)
  }
})
