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
// than shipping full-res photos to a phone screen.
const MAX_WIDTH = 1200;
const JPEG_QUALITY = 78;

// Decorative icons (serving-size glyphs, dividers) show up as tiny as 8-13px
// on a side; real recipe photos in these books start at 700px+. Anything
// under this on either dimension gets rejected as not-actually-a-photo.
const MIN_DIMENSION = 150;

// Only the books the extraction pipeline has processed so far.
const BOOK_TO_EPUB = {
  "5-Ingredient Vegan Cooking": "5-ingredientvegancooking.epub",
  "Awesome Vegan Soups": "awesomevegansoups.epub",
  "Frugal Vegan": "frugalvegan.epub",
  "New Vegan Baking": "newveganbaking.epub",
  "The Ultimate Vegan Cookbook": "ultimatevegancookbookthe.epub",
};

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

  const zipCache = new Map();
  const manifest = {};
  let resolved = 0;
  let missing = 0;
  const missingByBook = {};
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const recipe of recipes) {
    const epubName = BOOK_TO_EPUB[recipe.source_book];
    if (!epubName) continue; // book not yet in scope for image extraction

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
      .jpeg({ quality: JPEG_QUALITY, progressive: true, mozjpeg: true })
      .toBuffer();
    bytesBefore += rawBuffer.length;
    bytesAfter += resizedBuffer.length;

    // Re-encoded to JPEG regardless of source format, so the output extension is fixed.
    const outName = `${recipe.id}.jpg`;
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
}

main();
