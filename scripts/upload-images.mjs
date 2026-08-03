// Pushes app/public/images/recipes/*.webp to the Supabase Storage bucket
// `recipe-images`, so images stop being tracked in git as more books get
// processed. Run after extract-images.mjs.
//
// Usage: node --env-file=.env scripts/upload-images.mjs

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IMAGES_DIR = path.join(ROOT, "app", "public", "images", "recipes");
const UPLOAD_MANIFEST_PATH = path.join(__dirname, "upload-manifest.json");
const BUCKET = "recipe-images";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY. Copy scripts/.env.example to scripts/.env and " +
      "fill them in, then run with `node --env-file=.env scripts/upload-images.mjs`."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function readUploadManifest() {
  if (!fs.existsSync(UPLOAD_MANIFEST_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(UPLOAD_MANIFEST_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const localFiles = fs.readdirSync(IMAGES_DIR);
  const previouslyUploaded = readUploadManifest();
  const nowUploaded = {};

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const filename of localFiles) {
    const filePath = path.join(IMAGES_DIR, filename);
    const stat = fs.statSync(filePath);
    const fingerprint = `${stat.size}:${Math.floor(stat.mtimeMs)}`;

    if (previouslyUploaded[filename] === fingerprint) {
      nowUploaded[filename] = fingerprint;
      skipped++;
      continue;
    }

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, fs.readFileSync(filePath), {
        upsert: true,
        contentType: "image/webp",
      });

    if (error) {
      console.warn(`Failed to upload ${filename}:`, error.message);
      failed++;
      continue;
    }

    nowUploaded[filename] = fingerprint;
    uploaded++;
  }

  // Prune: remove any object in the bucket that no longer has a local file
  // (e.g. a recipe lost its image on re-extraction).
  const localSet = new Set(localFiles);
  let pruned = 0;
  let cursor = 0;
  const PAGE_SIZE = 1000;
  const staleNames = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: PAGE_SIZE, offset: cursor });
    if (error) {
      console.warn("Failed to list bucket contents for pruning:", error.message);
      break;
    }
    for (const object of data) {
      if (!localSet.has(object.name)) staleNames.push(object.name);
    }
    if (data.length < PAGE_SIZE) break;
    cursor += PAGE_SIZE;
  }
  if (staleNames.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(staleNames);
    if (error) {
      console.warn("Failed to prune stale objects:", error.message);
    } else {
      pruned = staleNames.length;
    }
  }

  fs.writeFileSync(UPLOAD_MANIFEST_PATH, JSON.stringify(nowUploaded, null, 2));

  console.log(
    `Uploaded ${uploaded}, skipped ${skipped} unchanged, ${failed} failed, pruned ${pruned} stale object(s).`
  );
}

main();
