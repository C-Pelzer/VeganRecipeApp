// Computes time/cuisine/ingredient tags for every recipe in
// app/public/data/recipes.json and replaces the full contents of the
// `recipe_tags` table with the result. Safe to re-run any time (e.g. after
// tuning a keyword list below, or after a new book is added) — this table
// only ever holds pipeline-computed output, nothing user-authored.
//
// Usage: node --env-file=.env tag-recipes.mjs
// (requires scripts/schema-recipe-tags.sql to have been run first)

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLE_PATH = path.join(ROOT, "app", "public", "data", "recipes.json");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY. Copy scripts/.env.example to scripts/.env and " +
      "fill them in, then run with `node --env-file=.env tag-recipes.mjs`."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Time buckets -----------------------------------------------------

const TIME_BUCKETS = [
  { slug: "time-15", label: "15 min or less", max: 15 },
  { slug: "time-30", label: "16–30 min", max: 30 },
  { slug: "time-60", label: "31–60 min", max: 60 },
  { slug: "time-60-plus", label: "Over 60 min", max: Infinity },
];

// time_text is free text from the book ("10 minutes", "6-8 MIN", "1 hr 30 min").
// Sum every hour/minute quantity found; if nothing parses, this recipe just
// doesn't get a time tag (same as diet_tags: absence is fine).
function parseMinutes(timeText) {
  if (!timeText) return null;
  const text = timeText.toLowerCase();
  let minutes = 0;
  let matched = false;
  for (const m of text.matchAll(/(\d+)\s*(hour|hr)s?\b/g)) {
    minutes += Number(m[1]) * 60;
    matched = true;
  }
  for (const m of text.matchAll(/(\d+)\s*(min|minute)s?\b/g)) {
    minutes += Number(m[1]);
    matched = true;
  }
  return matched ? minutes : null;
}

function timeTag(recipe) {
  const minutes = parseMinutes(recipe.time_text);
  if (minutes === null) return null;
  const bucket = TIME_BUCKETS.find((b) => minutes <= b.max);
  return { slug: bucket.slug, label: bucket.label };
}

// --- Ingredient tags ----------------------------------------------------

const TRACKED_INGREDIENTS = [
  "tofu",
  "tempeh",
  "seitan",
  "lentil",
  "chickpea",
  "black bean",
  "mushroom",
  "potato",
  "sweet potato",
  "rice",
  "pasta",
  "quinoa",
  "spinach",
  "kale",
  "cauliflower",
  "broccoli",
  "carrot",
  "zucchini",
  "avocado",
  "coconut",
  "peanut",
  "cashew",
  "almond",
];

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, "-");
}

function capitalize(text) {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function ingredientTags(recipe) {
  const items = recipe.ingredient_groups.flatMap((g) =>
    g.ingredients.map((i) => (i.item || "").toLowerCase())
  );
  const joined = items.join(" | ");
  const tags = [];
  for (const name of TRACKED_INGREDIENTS) {
    // Trailing s? so plural-only mentions ("lentils", "black beans") still match.
    const re = new RegExp(`\\b${name}s?\\b`);
    if (re.test(joined)) tags.push({ slug: slugify(name), label: capitalize(name) });
  }
  return tags;
}

// --- Cuisine tags ---------------------------------------------------------
// Deliberately no "American" catch-all — too broad/low-signal. Better to
// leave a recipe untagged for cuisine than force a bad guess. Extend this
// map as coverage gaps show up in the printed summary below.

const CUISINE_KEYWORDS = {
  Mexican: ["taco", "burrito", "enchilada", "quesadilla", "salsa", "guacamole", "tortilla", "mexican"],
  Italian: ["pasta", "risotto", "marinara", "pesto", "italian", "lasagna", "gnocchi"],
  Indian: ["curry", "masala", "tikka", "dal", "paneer", "naan", "indian", "biryani"],
  Thai: ["thai", "pad thai", "tom yum", "satay"],
  Chinese: ["chinese", "kung pao", "lo mein", "dumpling", "wonton"],
  Japanese: ["japanese", "sushi", "teriyaki", "miso", "udon", "ramen"],
  Mediterranean: ["mediterranean", "hummus", "falafel", "tzatziki", "tabbouleh", "pita"],
  French: ["french", "crepe", "quiche", "ratatouille"],
};

const CUISINE_PATTERNS = Object.entries(CUISINE_KEYWORDS).map(([cuisine, keywords]) => ({
  cuisine,
  pattern: new RegExp(`\\b(${keywords.join("|")})\\b`, "i"),
}));

function cuisineTags(recipe) {
  const text = `${recipe.title} ${recipe.headnote || ""}`;
  const tags = [];
  for (const { cuisine, pattern } of CUISINE_PATTERNS) {
    if (pattern.test(text)) tags.push({ slug: slugify(cuisine), label: cuisine });
  }
  return tags;
}

// --- Main -----------------------------------------------------------------

function buildRows(recipes) {
  const rows = [];
  for (const recipe of recipes) {
    const time = timeTag(recipe);
    if (time) rows.push({ recipe_id: recipe.id, category: "time", tag_slug: time.slug, label: time.label });

    for (const tag of ingredientTags(recipe)) {
      rows.push({ recipe_id: recipe.id, category: "ingredient", tag_slug: tag.slug, label: tag.label });
    }

    for (const tag of cuisineTags(recipe)) {
      rows.push({ recipe_id: recipe.id, category: "cuisine", tag_slug: tag.slug, label: tag.label });
    }
  }
  return rows;
}

async function replaceAllRows(rows) {
  const { error: deleteError } = await supabase
    .from("recipe_tags")
    .delete()
    .not("recipe_id", "is", null);
  if (deleteError) throw new Error(`Failed to clear recipe_tags: ${deleteError.message}`);

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("recipe_tags").insert(batch);
    if (error) throw new Error(`Failed to insert batch at offset ${i}: ${error.message}`);
  }
}

function printSummary(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.category}:${row.label}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`\n${rows.length} tag rows across ${sorted.length} distinct tags:`);
  for (const [key, count] of sorted) {
    console.log(`  ${key}: ${count}`);
  }
}

async function main() {
  const recipes = JSON.parse(fs.readFileSync(BUNDLE_PATH, "utf8"));
  const rows = buildRows(recipes);

  await replaceAllRows(rows);
  printSummary(rows);

  console.log(`\nTagged ${recipes.length} recipes.`);
}

main();
