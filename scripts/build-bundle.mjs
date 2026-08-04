// Merges recipes_metric.json with the image manifest and flags likely sub-recipes,
// producing the bundle the app fetches at runtime.
//
// Usage: node scripts/build-bundle.mjs (run extract-images.mjs first)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "app", "public", "data", "recipes.json");
const BUCKET = "recipe-images";

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) {
  throw new Error(
    "Missing SUPABASE_URL. Copy scripts/.env.example to scripts/.env and fill it in, then " +
      "run with `node --env-file=.env build-bundle.mjs`."
  );
}

// Images live in Supabase Storage (scripts/upload-images.mjs), not in the repo —
// the manifest only tells us the filename, so build the public object URL here.
function imageUrl(manifestPath) {
  if (!manifestPath) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.basename(manifestPath)}`;
}

// Component/sub-recipe words: a card offering "Cashew Cream" as dinner is the
// failure mode this guards against (see CLAUDE_CODE_BRIEF.md "Known gaps").
const COMPONENT_WORDS = [
  "cream",
  "sauce",
  "dressing",
  "stock",
  "broth",
  "dough",
  "crust",
  "glaze",
  "frosting",
  "dip",
  "seasoning",
  "spice mix",
  "spice blend",
  "marinade",
  "syrup",
  "compote",
  "chutney",
  "vinaigrette",
  "baharat",
  "pesto",
];

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "X with Y" / "X and Y" titles are composed dishes that happen to *name* a
// component (e.g. "Pumpkin Pie with Coconut Whipped Cream") — not the
// component itself. Excluding them cuts false positives substantially.
function isComposedDishTitle(title) {
  return /\bwith\b|\band\b/i.test(title);
}

function isNamedAsIngredientElsewhere(recipe, ingredientItemsByRecipe) {
  const words = normalizeTitle(recipe.title).split(" ").filter((w) => w.length > 2);
  if (!words.length) return false;
  // Tail words carry the noun phrase ("cashew cream", not "vegan easy cashew cream").
  const key = words.slice(-3).join(" ");

  for (const [otherId, items] of ingredientItemsByRecipe) {
    if (otherId === recipe.id) continue;
    if (items.some((item) => item.includes(key))) return true;
  }
  return false;
}

function looksLikeComponent(recipe, ingredientItemsByRecipe) {
  if (recipe.image) return false; // has its own photo -> treated as a real recipe
  if (recipe.ingredient_count > 6) return false;
  if (isComposedDishTitle(recipe.title)) return false;

  const title = recipe.title.toLowerCase();
  if (!COMPONENT_WORDS.some((word) => title.includes(word))) return false;

  // Word match alone is too loose (e.g. "Forbidden Rice Sushi Rolls" is a full
  // dish); require the title to also show up as an ingredient in another
  // recipe, confirming it's actually used as a component.
  return isNamedAsIngredientElsewhere(recipe, ingredientItemsByRecipe);
}

function buildIngredientItemsByRecipe(recipes) {
  const map = new Map();
  for (const recipe of recipes) {
    const items = [];
    for (const group of recipe.ingredient_groups) {
      for (const ingredient of group.ingredients) {
        if (ingredient.item) items.push(normalizeTitle(ingredient.item));
      }
    }
    map.set(recipe.id, items);
  }
  return map;
}

function main() {
  const recipes = JSON.parse(
    fs.readFileSync(path.join(ROOT, "recipes_metric.json"), "utf8")
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "scripts", "image-manifest.json"), "utf8")
  );
  const ingredientItemsByRecipe = buildIngredientItemsByRecipe(recipes);

  const bundle = recipes.map((recipe) => {
    const image = imageUrl(manifest[recipe.id]);
    const withImage = { ...recipe, image };
    return {
      ...withImage,
      isComponent: looksLikeComponent(withImage, ingredientItemsByRecipe),
      // Ingredients with no method steps at all aren't a lesser recipe, they're a
      // broken one (some books' step-vs-ingredient classifier misses entirely) —
      // exclude from the deck rather than surface as a "warning" like the softer
      // ones (e.g. "no servings found").
      hasSteps: recipe.steps.length > 0,
    };
  });

  const componentCount = bundle.filter((r) => r.isComponent).length;
  const noStepsCount = bundle.filter((r) => !r.hasSteps).length;
  const withImageCount = bundle.filter((r) => r.image).length;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(bundle));

  console.log(`Wrote ${bundle.length} recipes to ${path.relative(ROOT, OUT_PATH)}`);
  console.log(
    `  ${withImageCount} with images, ${componentCount} flagged as sub-recipes, ` +
      `${noStepsCount} with no method steps`
  );
}

main();
