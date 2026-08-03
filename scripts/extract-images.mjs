// Pulls each recipe's hero image out of its source epub and writes a manifest.
//
// Recipes carry source_file (path to their xhtml inside the epub) but no image
// reference — this recovers one by parsing that xhtml for its <img> tag.
//
// Usage: node scripts/extract-images.mjs

import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EPUB_DIR = "C:\\Users\\Cameron\\Documents\\Vegan Cookbooks";
const OUT_DIR = path.join(ROOT, "app", "public", "images", "recipes");
const MANIFEST_PATH = path.join(ROOT, "scripts", "image-manifest.json");

// Only the books the extraction pipeline has processed so far.
const BOOK_TO_EPUB = {
  "5-Ingredient Vegan Cooking": "5-ingredientvegancooking.epub",
  "Awesome Vegan Soups": "awesomevegansoups.epub",
  "Frugal Vegan": "frugalvegan.epub",
  "New Vegan Baking": "newveganbaking.epub",
  "The Ultimate Vegan Cookbook": "ultimatevegancookbookthe.epub",
};

function findHeroImageSrc(xhtml) {
  // Prefer an <img> inside a <div class="figure">: the recipe photo. Decorative
  // icons (serving-size glyphs, etc.) live outside figure divs in every sample checked.
  const figureMatch = xhtml.match(
    /<div[^>]*class="[^"]*figure[^"]*"[^>]*>[\s\S]*?<img[^>]*\ssrc="([^"]+)"/
  );
  if (figureMatch) return figureMatch[1];

  const anyImgMatch = xhtml.match(/<img[^>]*\ssrc="([^"]+)"/);
  return anyImgMatch ? anyImgMatch[1] : null;
}

function main() {
  const recipes = JSON.parse(
    fs.readFileSync(path.join(ROOT, "recipes_metric.json"), "utf8")
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const zipCache = new Map();
  const manifest = {};
  let resolved = 0;
  let missing = 0;
  const missingByBook = {};

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
    const imgSrc = findHeroImageSrc(xhtml);
    if (!imgSrc) {
      missing++;
      missingByBook[recipe.source_book] = (missingByBook[recipe.source_book] || 0) + 1;
      continue;
    }

    // imgSrc is relative to the xhtml file's own directory inside the epub.
    const imgPath = path
      .posix.join(path.posix.dirname(recipe.source_file.replace(/\\/g, "/")), imgSrc)
      .replace(/^\/+/, "");
    const imgEntry = zip.getEntry(imgPath);
    if (!imgEntry) {
      missing++;
      missingByBook[recipe.source_book] = (missingByBook[recipe.source_book] || 0) + 1;
      continue;
    }

    const ext = path.extname(imgPath) || ".jpg";
    const outName = `${recipe.id}${ext}`;
    fs.writeFileSync(path.join(OUT_DIR, outName), imgEntry.getData());
    manifest[recipe.id] = `images/recipes/${outName}`;
    resolved++;
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`Resolved ${resolved} images, ${missing} recipes without one.`);
  if (missing) {
    console.log("Missing by book:", missingByBook);
  }
}

main();
