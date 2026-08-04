// Pulls each recipe's hero image out of its source epub and writes a manifest.
//
// Recipes carry source_file (path to their xhtml inside the epub) but no image
// reference — this recovers one by parsing that xhtml for its <img> tag.
//
// Usage: node scripts/extract-images.mjs

import AdmZip from "adm-zip";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EPUB_DIR = "C:\\Users\\Cameron\\Documents\\Vegan Cookbooks";
const OUT_DIR = path.join(ROOT, "app", "public", "images", "recipes");
const MANIFEST_PATH = path.join(ROOT, "scripts", "image-manifest.json");

// Source images are print-resolution (2-4 MB each) for a card that renders
// at a few hundred CSS px. Downscaling + re-encoding at extraction time is
// the single biggest lever on repo/storage size — do it once here rather
// than shipping full-res photos to a phone screen. 700px covers even 2-3x
// device pixel ratios at typical card width; WebP beats JPEG noticeably at
// matched visual quality (tested against mozjpeg — WebP q68 came out
// 65-73% smaller than the previous 1200px/JPEG-q78 setting with no visible
// artifacts, since Android Chrome — the only target here — has always had
// full WebP support).
const MAX_WIDTH = 700;
const WEBP_QUALITY = 68;

// Decorative icons (serving-size glyphs, dividers) show up as tiny as 8-13px
// on a side; real recipe photos in these books start at 700px+. Anything
// under this on either dimension gets rejected as not-actually-a-photo.
const MIN_DIMENSION = 150;

// Book title -> epub filename overrides, for the rare title resolveEpubFilename()
// below gets wrong. Empty until a real one shows up.
const BOOK_TO_EPUB_OVERRIDES = {};

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]/g, "");

// The 61 source epub filenames turn out to follow one of two patterns:
// plain ("Awesome Vegan Soups" -> awesomevegansoups.epub) or a leading "The"
// moved to the end ("The Ultimate Vegan Cookbook" -> ultimatevegancookbookthe.epub).
// Matching against the slugified filename avoids hand-maintaining a map for
// all 61 books as they get processed.
function resolveEpubFilename(bookTitle, epubFilenames) {
  if (BOOK_TO_EPUB_OVERRIDES[bookTitle]) return BOOK_TO_EPUB_OVERRIDES[bookTitle];

  const bare = slugify(bookTitle);
  const theSuffixed = slugify(bookTitle.replace(/^the\s+/i, "")) + "the";
  const slugToFile = new Map(
    epubFilenames.map((f) => [slugify(f.replace(/\.epub$/i, "")), f])
  );

  if (slugToFile.has(bare)) return slugToFile.get(bare);
  if (slugToFile.has(theSuffixed)) return slugToFile.get(theSuffixed);

  // The book's metadata title and the epub's filename don't always agree on
  // which one includes the subtitle -- fall back to a same-direction prefix
  // match, long enough on whichever side is shorter to not risk a false hit.
  for (const [fileSlug, f] of slugToFile) {
    if (bare.length >= 10 && fileSlug.startsWith(bare)) return f;
    if (fileSlug.length >= 6 && bare.startsWith(fileSlug)) return f;
  }
  return null;
}

function findAll(xhtml, pattern) {
  return [...xhtml.matchAll(pattern)].map((m) => m[1]);
}

// Returns candidate <img> srcs in priority order: figure-div images first
// (most likely the recipe photo), then any other <img> as a fallback. Every
// candidate still has to clear the MIN_DIMENSION check in main() before
// it's accepted — the fallback tier is where decorative icons leak in, so
// order alone isn't enough to trust it.
function findCandidateImageSrcs(xhtml) {
  const figureSrcs = findAll(
    xhtml,
    /<div[^>]*class="[^"]*figure[^"]*"[^>]*>[\s\S]*?<img[^>]*\ssrc="([^"]+)"/g
  );
  const allSrcs = findAll(xhtml, /<img[^>]*\ssrc="([^"]+)"/g);

  const seen = new Set();
  return [...figureSrcs, ...allSrcs].filter((src) => {
    if (seen.has(src)) return false;
    seen.add(src);
    return true;
  });
}

async function main() {
  const recipes = JSON.parse(
    fs.readFileSync(path.join(ROOT, "recipes_metric.json"), "utf8")
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const epubFilenames = fs.readdirSync(EPUB_DIR).filter((f) => /\.epub$/i.test(f));
  const epubNameByBook = new Map();
  const unresolvedBooks = new Set();

  const zipCache = new Map();
  const manifest = {};
  let resolved = 0;
  let missing = 0;
  const missingByBook = {};
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const recipe of recipes) {
    if (!epubNameByBook.has(recipe.source_book)) {
      epubNameByBook.set(
        recipe.source_book,
        resolveEpubFilename(recipe.source_book, epubFilenames)
      );
    }
    const epubName = epubNameByBook.get(recipe.source_book);
    if (!epubName) {
      unresolvedBooks.add(recipe.source_book);
      continue; // no matching epub found — add an override once the real filename is known
    }

    if (!zipCache.has(epubName)) {
      zipCache.set(epubName, new AdmZip(path.join(EPUB_DIR, epubName)));
    }
    const zip = zipCache.get(epubName);

    const entry = zip.getEntry(recipe.source_file);
    if (!entry) {
      missing++;
      missingByBook[recipe.source_book] = (missingByBook[recipe.source_book] || 0) + 1;
      continue;
    }

    const xhtml = entry.getData().toString("utf8");
    const candidateSrcs = findCandidateImageSrcs(xhtml);

    let rawBuffer = null;
    for (const imgSrc of candidateSrcs) {
      // imgSrc is relative to the xhtml file's own directory inside the epub.
      const imgPath = path
        .posix.join(path.posix.dirname(recipe.source_file.replace(/\\/g, "/")), imgSrc)
        .replace(/^\/+/, "");
      const imgEntry = zip.getEntry(imgPath);
      if (!imgEntry) continue;

      const candidateBuffer = imgEntry.getData();
      const metadata = await sharp(candidateBuffer).metadata();
      const tooSmall =
        (metadata.width ?? 0) < MIN_DIMENSION || (metadata.height ?? 0) < MIN_DIMENSION;
      if (tooSmall) continue; // decorative icon, not a photo — try the next candidate

      rawBuffer = candidateBuffer;
      break;
    }

    if (!rawBuffer) {
      missing++;
      missingByBook[recipe.source_book] = (missingByBook[recipe.source_book] || 0) + 1;
      continue;
    }

    const resizedBuffer = await sharp(rawBuffer)
      .rotate() // normalize EXIF orientation before dropping the metadata that carries it
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    bytesBefore += rawBuffer.length;
    bytesAfter += resizedBuffer.length;

    // Re-encoded to WebP regardless of source format, so the output extension is fixed.
    const outName = `${recipe.id}.webp`;
    fs.writeFileSync(path.join(OUT_DIR, outName), resizedBuffer);
    manifest[recipe.id] = `images/recipes/${outName}`;
    resolved++;
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  // Remove files left behind by a previous run whose recipe no longer maps
  // to an image (e.g. it was rejected as a decorative icon this time).
  const expectedFiles = new Set(Object.values(manifest).map((p) => path.basename(p)));
  let orphansRemoved = 0;
  for (const existing of fs.readdirSync(OUT_DIR)) {
    if (!expectedFiles.has(existing)) {
      fs.unlinkSync(path.join(OUT_DIR, existing));
      orphansRemoved++;
    }
  }

  const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);
  console.log(`Resolved ${resolved} images, ${missing} recipes without one.`);
  console.log(
    `Size: ${mb(bytesBefore)} MB -> ${mb(bytesAfter)} MB (${(
      (1 - bytesAfter / bytesBefore) *
      100
    ).toFixed(0)}% smaller)`
  );
  if (missing) {
    console.log("Missing by book:", missingByBook);
  }
  if (orphansRemoved) {
    console.log(`Removed ${orphansRemoved} orphaned image file(s) from a previous run.`);
  }
  if (unresolvedBooks.size) {
    console.log(
      `Could not match an epub for ${unresolvedBooks.size} book(s) — add an override in ` +
        `BOOK_TO_EPUB_OVERRIDES:`,
      [...unresolvedBooks]
    );
  }
}

main();
