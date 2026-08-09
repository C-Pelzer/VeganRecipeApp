// Materializes one 'auto' swipe deck per (category, tag_slug) in
// recipe_tags, layering recipe_tag_overrides on top the same way the app
// does (app/src/lib/tags.ts effectiveTagsByRecipe), then replaces the full
// contents of the 'auto' rows in swipe_decks/swipe_deck_recipes with the
// result. Run this after tag-recipes.mjs, any time tags change and you want
// decks to reflect it — decks are snapshots, not live filters, so nothing
// updates until this is re-run.
//
// Each deck is capped at 40 recipes, chosen at random from that tag's
// matches — re-running reshuffles which 40 show up. 'manual' decks (built by
// hand in the Catalog deck builder) are untouched by this script.
//
// Usage: node --env-file=.env build-swipe-decks.mjs
// (requires scripts/schema-swipe-decks.sql and
// scripts/schema-recipe-tag-overrides.sql to have been run first)

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLE_PATH = path.join(ROOT, "app", "public", "data", "recipes.json");

const MAX_DECK_SIZE = 40;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY. Copy scripts/.env.example to scripts/.env and " +
      "fill them in, then run with `node --env-file=.env build-swipe-decks.mjs`."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Fisher-Yates, same as app/src/features/deck/DeckScreen.tsx's shuffle().
function shuffle(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Sub-recipes and broken extractions never belong in a swipe deck — same
// filter as DeckScreen's isDeckEligible.
function isDeckEligible(recipe) {
  return !recipe.isComponent && recipe.hasSteps;
}

// PostgREST caps a single .select() at db-max-rows (1000 by default on
// Supabase) with no error — just a silently truncated result. recipe_tags
// alone is now ~5-6x that (one book tag per recipe on top of everything
// else), so a bare .select() here was quietly only ever seeing the first
// ~1000 rows — recipes are stored book-by-book, so in practice that meant
// only the first couple of books' tags existed at all from this script's
// point of view. Page through with .range() instead.
const PAGE_SIZE = 1000;

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

// Auto tags plus overrides layered on top, same semantics as
// app/src/lib/tags.ts effectiveTagsByRecipe: 'remove' drops an auto tag,
// 'add' introduces one that isn't there. Keyed by "category::tagSlug" so
// two categories can each have (say) a "rice" slug without colliding.
function buildEffectiveTagGroups(recipeTagRows, overrideRows, eligibleRecipeIds) {
  const groups = new Map(); // "category::tagSlug" -> { category, tagSlug, label, recipeIds: Set }

  function group(category, tagSlug, label) {
    const key = `${category}::${tagSlug}`;
    if (!groups.has(key)) groups.set(key, { category, tagSlug, label, recipeIds: new Set() });
    return groups.get(key);
  }

  for (const row of recipeTagRows) {
    if (!eligibleRecipeIds.has(row.recipe_id)) continue;
    group(row.category, row.tag_slug, row.label).recipeIds.add(row.recipe_id);
  }

  for (const row of overrideRows) {
    if (!eligibleRecipeIds.has(row.recipe_id)) continue;
    const g = group(row.category, row.tag_slug, row.label);
    if (row.action === "remove") g.recipeIds.delete(row.recipe_id);
    else g.recipeIds.add(row.recipe_id);
  }

  return [...groups.values()].filter((g) => g.recipeIds.size > 0);
}

function buildDeckRows(groups) {
  const decks = [];
  const deckRecipes = [];
  for (const g of groups) {
    const id = `${g.category}-${g.tagSlug}`;
    decks.push({
      id,
      label: g.label,
      source: "auto",
      category: g.category,
      tag_slug: g.tagSlug,
      created_by: "system",
    });
    const sampled = shuffle([...g.recipeIds]).slice(0, MAX_DECK_SIZE);
    sampled.forEach((recipeId, position) => {
      deckRecipes.push({ deck_id: id, recipe_id: recipeId, position });
    });
  }
  return { decks, deckRecipes };
}

async function replaceAutoDecks(decks, deckRecipes) {
  // Cascades to swipe_deck_recipes (and swipe_deck_shares, though auto decks
  // shouldn't have any — sharing only applies to manual decks).
  const { error: deleteError } = await supabase.from("swipe_decks").delete().eq("source", "auto");
  if (deleteError) throw new Error(`Failed to clear auto swipe_decks: ${deleteError.message}`);

  const BATCH_SIZE = 500;
  for (let i = 0; i < decks.length; i += BATCH_SIZE) {
    const batch = decks.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("swipe_decks").insert(batch);
    if (error) throw new Error(`Failed to insert swipe_decks batch at offset ${i}: ${error.message}`);
  }

  for (let i = 0; i < deckRecipes.length; i += BATCH_SIZE) {
    const batch = deckRecipes.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("swipe_deck_recipes").insert(batch);
    if (error) throw new Error(`Failed to insert swipe_deck_recipes batch at offset ${i}: ${error.message}`);
  }
}

function printSummary(groups, deckRecipes) {
  const countByDeck = new Map();
  for (const row of deckRecipes) {
    countByDeck.set(row.deck_id, (countByDeck.get(row.deck_id) || 0) + 1);
  }
  const sorted = [...groups].sort((a, b) => `${a.category}${a.tagSlug}`.localeCompare(`${b.category}${b.tagSlug}`));
  console.log(`\nBuilt ${sorted.length} auto decks:`);
  for (const g of sorted) {
    const id = `${g.category}-${g.tagSlug}`;
    console.log(`  ${id}: ${countByDeck.get(id) || 0} recipes (of ${g.recipeIds.size} matching)`);
  }
}

async function main() {
  const recipes = JSON.parse(fs.readFileSync(BUNDLE_PATH, "utf8"));
  const eligibleRecipeIds = new Set(recipes.filter(isDeckEligible).map((r) => r.id));

  const [recipeTagRows, overrideRows] = await Promise.all([
    fetchAll("recipe_tags", "recipe_id, category, tag_slug, label"),
    fetchAll("recipe_tag_overrides", "recipe_id, category, tag_slug, label, action"),
  ]);

  const groups = buildEffectiveTagGroups(recipeTagRows, overrideRows, eligibleRecipeIds);
  const { decks, deckRecipes } = buildDeckRows(groups);

  await replaceAutoDecks(decks, deckRecipes);
  printSummary(groups, deckRecipes);

  console.log(`\nBuilt ${decks.length} decks from ${groups.length} tags.`);
}

main();
