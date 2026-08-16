// Computes tags for every recipe in app/public/data/recipes.json and replaces
// the full contents of the `recipe_tags` table with the result. Safe to re-run
// any time (e.g. after tuning a keyword list below, or after a new book is
// added) — this table only ever holds pipeline-computed output. User-authored
// edits live separately in `recipe_tag_overrides` and are never touched here.
//
// Usage: node --env-file=.env tag-recipes.mjs [--dry-run]
//   --dry-run   compute everything, write scripts/tag-report.txt, print a diff
//               against the live table, and write NOTHING. Do this first.
// (requires scripts/schema-recipe-tags.sql to have been run first)
//
// --- How matching works ---------------------------------------------------
// The previous version asked "does any keyword appear anywhere in title +
// headnote?" and tagged on a boolean hit. That produced three failure modes,
// all measured against the real 4,865-recipe bundle:
//
//   * `\b<name>s?\b` never matches an "-es" plural, so 288 recipes containing
//     "potatoes" got no potato tag — while `\bpotato\b` happily matched inside
//     "sweet potato", so 120 sweet-potato-only recipes got tagged potato. The
//     potato deck was wrong in both directions at once.
//   * "pie" tagged SHEPHERD'S PIE as a Dessert.
//   * "curry" tagged JACKFRUIT YELLOW THAI CURRY as Indian as well as Thai.
//
// So matching is now evidence-weighted rather than boolean:
//   * Ingredients match against the parsed ingredient list with real plural
//     forms, longest-phrase-first, and each match *masks* the text it consumed
//     so a specific phrase blocks a generic one ("sweet potato" eats the word
//     before "potato" can see it).
//   * Cuisine keywords are split strong (names, signature dishes) vs weak
//     (ambiguous dishes like "curry"). A strong title hit wins outright, so a
//     Thai curry stops being Indian too.
//   * Course keywords carry exclusions, so "pie" only means dessert when the
//     title isn't a pot/shepherd's/tamale pie or a quiche.
//   * Title evidence outweighs headnote evidence everywhere. Headnotes mention
//     ingredients and cuisines incidentally ("great alongside tacos") and were
//     the source of 438 cuisine tags with no cuisine word in the title at all.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUNDLE_PATH = path.join(ROOT, "app", "public", "data", "recipes.json");
const REPORT_PATH = path.join(__dirname, "tag-report.txt");

const DRY_RUN = process.argv.includes("--dry-run");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY. Copy scripts/.env.example to scripts/.env and " +
      "fill them in, then run with `node --env-file=.env tag-recipes.mjs`."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Text helpers ---------------------------------------------------------

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A handful of books set a decorative drop-cap in its own span, so the
// extractor emitted "V ANILLA Y OGURT" — which no keyword can match. The app
// repairs these for display in app/src/lib/recipeTitle.ts; this is the
// matching-relevant half of that logic, kept local so the pipeline has no
// dependency on the app's TypeScript. Casing is irrelevant here because every
// pattern below is case-insensitive.
const DROP_CAP = /(^|\s)(\p{Pd}?)(?<!['’]\s)(\p{Lu})\s(\p{Lu}[\p{Lu}'’]*)/gu;
const CONSONANT_SPLIT = /(^|\s)\p{Pd}?[BCDFGHJKLMNPQRSTVWXZ]\s\p{Lu}{2,}/u;

function repairTitle(title) {
  const text = (title || "").replace(/\s+/g, " ").trim();
  if (!CONSONANT_SPLIT.test(text)) return text;
  return text
    .replace(DROP_CAP, (_m, pre, dash, letter, rest) => `${pre}${dash}${letter}${rest}`)
    .replace(/(\p{L})\s+(\p{Pd})(\p{L})/gu, "$1$2$3");
}

// "potato" -> potatoes, "berry" -> berries. The old `s?` suffix produced
// "potatos", which matches nothing a cookbook ever prints.
function pluralForms(word) {
  const forms = new Set([word]);
  forms.add(`${word}s`);
  if (/(s|x|z|ch|sh|o)$/.test(word)) forms.add(`${word}es`);
  if (/[^aeiou]y$/.test(word)) forms.add(word.replace(/y$/, "ies"));
  return [...forms];
}

// Matches definitions against text longest-phrase-first, blanking out each hit
// so a more specific phrase consumes the words a generic one would have seen.
// This is what keeps "sweet potato" from also registering as "potato".
function matchMasked(text, defs) {
  const pairs = [];
  for (const def of defs) {
    for (const word of def.words) {
      for (const form of pluralForms(word)) pairs.push({ def, form });
    }
  }
  pairs.sort((a, b) => b.form.length - a.form.length);

  let masked = ` ${text} `;
  const hits = new Set();
  for (const { def, form } of pairs) {
    const re = new RegExp(`\\b${escapeRe(form)}\\b`, "gi");
    const next = masked.replace(re, (m) => " ".repeat(m.length));
    if (next !== masked) {
      hits.add(def);
      masked = next;
    }
  }
  return [...hits];
}

// Pluralises the last word of a phrase ("pot pie" -> "pot pies"), because a
// cookbook titles the recipe "Cookies", not "Cookie". Without this, course and
// cuisine matching silently missed every plural title — S'MORES COOKIES, KEY
// LIME CHEESECAKES and PANCAKES all came out with no course at all.
function phraseForms(phrase) {
  const parts = phrase.split(" ");
  const last = parts.pop();
  return pluralForms(last).map((form) => [...parts, form].join(" "));
}

function hasAny(text, phrases) {
  return phrases.some((p) =>
    phraseForms(p).some((form) => new RegExp(`\\b${escapeRe(form)}\\b`, "i").test(text))
  );
}

// --- Time buckets ---------------------------------------------------------

// Bare bucket names, not "time-15" etc. — build-swipe-decks.mjs already
// prepends the category ("time-") when it builds a deck id, so baking it in
// here too produced doubled ids like "time-time-15".
const TIME_BUCKETS = [
  { slug: "15", label: "15 min or less", max: 15 },
  { slug: "30", label: "16–30 min", max: 30 },
  { slug: "60", label: "31–60 min", max: 60 },
  { slug: "60-plus", label: "Over 60 min", max: Infinity },
];

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

// --- Ingredient tags ------------------------------------------------------
// Order within the list doesn't matter — matchMasked sorts by phrase length —
// but the aliases do: they're how a recipe calling for "russet" or "garbanzo"
// still lands in the right deck.

const INGREDIENTS = [
  { label: "Sweet Potato", words: ["sweet potato", "yam"] },
  { label: "Potato", words: ["potato", "russet", "yukon gold", "fingerling"] },
  { label: "Tofu", words: ["tofu"] },
  { label: "Tempeh", words: ["tempeh"] },
  { label: "Seitan", words: ["seitan", "vital wheat gluten"] },
  { label: "Lentil", words: ["lentil", "red lentil", "green lentil"] },
  { label: "Chickpea", words: ["chickpea", "garbanzo"] },
  { label: "Black Bean", words: ["black bean"] },
  { label: "White Bean", words: ["white bean", "cannellini", "navy bean", "great northern bean"] },
  { label: "Mushroom", words: ["mushroom", "portobello", "portabella", "shiitake", "cremini"] },
  { label: "Jackfruit", words: ["jackfruit"] },
  { label: "Rice", words: ["rice", "basmati", "jasmine rice", "arborio"] },
  { label: "Pasta", words: ["pasta", "spaghetti", "penne", "rotini", "linguine", "fettuccine", "macaroni", "orzo", "rigatoni"] },
  { label: "Noodle", words: ["noodle", "ramen", "soba", "udon", "rice noodle"] },
  { label: "Quinoa", words: ["quinoa"] },
  { label: "Spinach", words: ["spinach"] },
  { label: "Kale", words: ["kale"] },
  { label: "Cauliflower", words: ["cauliflower"] },
  { label: "Broccoli", words: ["broccoli", "broccolini"] },
  { label: "Carrot", words: ["carrot"] },
  { label: "Zucchini", words: ["zucchini", "courgette"] },
  { label: "Butternut Squash", words: ["butternut squash", "butternut"] },
  { label: "Pumpkin", words: ["pumpkin"] },
  { label: "Eggplant", words: ["eggplant", "aubergine"] },
  { label: "Avocado", words: ["avocado"] },
  { label: "Coconut", words: ["coconut"] },
  { label: "Peanut", words: ["peanut"] },
  { label: "Cashew", words: ["cashew"] },
  { label: "Almond", words: ["almond"] },
  { label: "Walnut", words: ["walnut"] },
  { label: "Chocolate", words: ["chocolate", "cocoa", "cacao"] },
  { label: "Berry", words: ["berry", "strawberry", "blueberry", "raspberry", "blackberry"] },
  { label: "Banana", words: ["banana"] },
  { label: "Apple", words: ["apple"] },
  { label: "Corn", words: ["corn", "sweetcorn"] },
  { label: "Tomato", words: ["tomato"] },
];

function ingredientText(recipe) {
  return recipe.ingredient_groups
    .flatMap((g) => g.ingredients.map((i) => i.item || ""))
    .join(" | ")
    .toLowerCase();
}

function ingredientTags(recipe) {
  // Deliberately ingredient-list-only. A headnote saying "serve over rice"
  // shouldn't put a dish in the rice deck.
  return matchMasked(ingredientText(recipe), INGREDIENTS).map((d) => ({
    slug: slugify(d.label),
    label: d.label,
  }));
}

// --- Cuisine tags ---------------------------------------------------------
// strong = the cuisine's own name, or a dish that belongs to exactly one
// cuisine. weak = a dish several cuisines share ("curry", "dumpling").
// Still no "American" catch-all — too broad to be a useful deck.

const CUISINES = [
  {
    label: "Mexican",
    strong: ["mexican", "taco", "burrito", "enchilada", "quesadilla", "guacamole", "tortilla", "tostada", "pozole", "mole", "elote", "chilaquiles", "tamale", "sope", "birria"],
    weak: ["salsa", "queso", "jalapeño", "chipotle", "masa"],
  },
  {
    label: "Italian",
    strong: ["italian", "risotto", "marinara", "lasagna", "gnocchi", "bruschetta", "caprese", "carbonara", "cacio e pepe", "focaccia", "arrabbiata", "puttanesca", "piccata"],
    weak: ["pasta", "pesto", "parmesan", "polenta", "ricotta"],
  },
  {
    label: "Indian",
    strong: ["indian", "masala", "tikka", "biryani", "paneer", "naan", "dosa", "samosa", "vindaloo", "chana", "saag", "korma", "raita", "chutney", "aloo", "pakora"],
    weak: ["curry", "dal", "dahl", "turmeric", "garam"],
  },
  {
    label: "Thai",
    strong: ["thai", "pad thai", "tom yum", "tom kha", "massaman", "panang", "larb", "red curry", "green curry", "yellow curry", "drunken noodle"],
    weak: ["satay", "lemongrass", "galangal", "fish sauce"],
  },
  {
    label: "Chinese",
    strong: ["chinese", "kung pao", "lo mein", "chow mein", "wonton", "szechuan", "sichuan", "mapo", "bao", "general tso", "hoisin", "stir-fry", "stir fry"],
    weak: ["dumpling", "soy sauce", "sesame oil", "bok choy"],
  },
  {
    label: "Japanese",
    strong: ["japanese", "sushi", "teriyaki", "udon", "ramen", "onigiri", "katsu", "okonomiyaki", "donburi", "yakisoba"],
    weak: ["miso", "nori", "edamame", "panko", "mirin"],
  },
  {
    label: "Korean",
    strong: ["korean", "bibimbap", "bulgogi", "kimchi", "gochujang", "japchae", "tteokbokki"],
    weak: ["gochugaru"],
  },
  {
    label: "Vietnamese",
    strong: ["vietnamese", "banh mi", "pho", "bun cha", "goi cuon"],
    weak: ["rice paper", "hoisin"],
  },
  {
    label: "Mediterranean",
    strong: ["mediterranean", "hummus", "falafel", "tzatziki", "tabbouleh", "shawarma", "baba ganoush", "dolma", "spanakopita", "gyro"],
    weak: ["pita", "tahini", "za'atar", "sumac", "olive oil", "feta"],
  },
  {
    label: "Middle Eastern",
    strong: ["middle eastern", "shakshuka", "fattoush", "kibbeh", "muhammara", "fatteh", "moghrabieh", "maftoul", "harissa"],
    weak: ["pomegranate molasses", "labneh", "freekeh"],
  },
  {
    label: "Caribbean",
    strong: ["caribbean", "jamaican", "jerk", "ackee", "callaloo", "plantain", "roti", "escovitch"],
    weak: ["allspice", "scotch bonnet"],
  },
  {
    label: "French",
    strong: ["french", "crepe", "quiche", "ratatouille", "baguette", "cassoulet", "beignet", "tarte tatin", "ratatouille"],
    weak: ["dijon", "herbes de provence", "béchamel"],
  },
  {
    label: "Southern",
    strong: ["southern", "gumbo", "jambalaya", "cajun", "creole", "hush puppy", "cornbread", "grits", "po' boy", "biscuits and gravy", "étouffée"],
    weak: ["collard", "okra", "black-eyed pea"],
  },
  {
    label: "Ethiopian",
    strong: ["ethiopian", "injera", "berbere", "wat", "shiro"],
    weak: [],
  },
];

// Title evidence is worth more than headnote evidence, and a strong keyword is
// worth more than a weak one. A strong hit in the title short-circuits the rest
// so an unambiguous dish name isn't diluted by incidental mentions.
function cuisineTags(recipe) {
  const title = repairTitle(recipe.title);
  const headnote = recipe.headnote || "";

  const scored = CUISINES.map((c) => {
    let score = 0;
    let strongTitle = false;
    if (hasAny(title, c.strong)) {
      score += 4;
      strongTitle = true;
    }
    if (hasAny(title, c.weak)) score += 2;
    if (hasAny(headnote, c.strong)) score += 2;
    if (hasAny(headnote, c.weak)) score += 1;
    return { cuisine: c, score, strongTitle };
  }).filter((s) => s.score > 0);

  if (scored.length === 0) return [];

  // An unambiguous name in the title beats everything else on the page.
  const strong = scored.filter((s) => s.strongTitle);
  const winners = strong.length > 0 ? strong : scored.filter((s) => s.score >= 2);

  return winners.map((s) => ({ slug: slugify(s.cuisine.label), label: s.cuisine.label }));
}

// --- Course tags ----------------------------------------------------------
// `exclude` is what stops "pie" from making SHEPHERD'S PIE a dessert. Course is
// judged on the title alone unless a headnote phrase is decisive on its own
// ("for dessert", "as an appetizer") — a headnote that merely mentions soup
// isn't evidence the dish is one.

const COURSES = [
  {
    label: "Appetizer",
    include: ["appetizer", "starter", "dip", "finger food", "canapé", "crostini", "bruschetta", "poppers", "bites"],
    headnote: ["as an appetizer", "for an appetizer", "party starter"],
    exclude: [],
  },
  {
    label: "Soup",
    include: ["soup", "stew", "chowder", "bisque", "broth", "chili", "pho", "ramen", "gumbo"],
    headnote: [],
    exclude: [],
  },
  {
    label: "Salad",
    include: ["salad", "slaw"],
    headnote: [],
    exclude: [],
  },
  {
    label: "Side",
    include: ["side dish", "side"],
    headnote: ["as a side", "for a side"],
    exclude: ["side of"],
  },
  {
    label: "Dessert",
    include: ["dessert", "cake", "cookie", "pie", "brownie", "pudding", "ice cream", "tart", "cheesecake", "cupcake", "mousse", "fudge", "truffle", "cobbler", "crumble", "crisp", "crispie", "donut", "doughnut", "macaroon", "macaron", "galette", "clafoutis", "blondie", "custard", "flan", "tiramisu", "praline", "toffee", "sorbet", "gelato", "parfait", "cinnamon roll", "sweet roll", "buckle", "cluster", "brittle", "bark", "slab", "square"],
    // Desserts are named by compounding onto a base word — shortcake, coffee
    // cake, teacake — which a whole-word list can't enumerate. `exclude` is
    // checked first, so pancake/crab cake/rice cake never reach this.
    suffix: ["cake"],
    headnote: ["for dessert"],
    // Every savory thing that borrows a dessert word.
    exclude: ["pot pie", "shepherd", "shepherd's", "shepherds", "shepherdless", "cottage pie", "tamale pie", "quiche", "savory pie", "crab cake", "fish cake", "bean cake", "rice cake", "pancake", "hot pot"],
  },
  {
    label: "Breakfast",
    include: ["breakfast", "brunch", "pancake", "waffle", "granola", "oatmeal", "overnight oats", "french toast", "scramble", "muffin", "smoothie bowl", "hash", "porridge", "crepe", "blintz", "scone", "bagel", "frittata", "tofu scramble", "chia pudding", "acai bowl"],
    headnote: ["for breakfast"],
    exclude: [],
  },
  {
    label: "Snack",
    include: ["snack", "trail mix", "energy ball", "energy bite", "popcorn", "cracker", "jerky"],
    headnote: [],
    exclude: [],
  },
  {
    // Without this, a dinner like SHEPHERD'S PIE came out with no course at all
    // — the old keyword list only had "entree"/"main course"/"main dish", which
    // a cookbook almost never prints in a recipe title. These are the dish
    // shapes a main actually gets named after.
    label: "Main",
    include: [
      "entree", "main course", "main dish", "dinner", "casserole", "bowl", "burger", "sandwich",
      "wrap", "pizza", "taco", "burrito", "enchilada", "lasagna", "curry", "stir-fry", "stir fry",
      "pot pie", "shepherd's pie", "shepherds pie", "shepherdless pie", "loaf", "meatball",
      "steak", "roast", "risotto", "paella", "pilaf", "skillet", "stuffed", "kebab", "quiche",
      "pasta", "noodle", "gnocchi", "chili", "gumbo", "jambalaya", "hash", "fajita", "quesadilla",
    ],
    headnote: ["as a main", "for dinner", "main course"],
    exclude: ["dressing", "sauce for", "dip"],
  },
  {
    label: "Beverage",
    include: ["smoothie", "cocktail", "beverage", "drink", "shake", "latte", "juice", "lemonade", "tea", "coffee", "hot chocolate"],
    headnote: [],
    exclude: ["smoothie bowl"],
  },
  {
    label: "Bread",
    include: ["bread", "roll", "bun", "biscuit", "focaccia", "flatbread", "scone", "bagel", "tortilla"],
    headnote: [],
    exclude: ["bread crumb", "breadcrumb"],
  },
  {
    label: "Sauce & Condiment",
    include: ["sauce", "dressing", "salsa", "chutney", "pesto", "aioli", "marinade", "glaze", "spread", "jam", "relish"],
    headnote: [],
    exclude: [],
  },
];

function courseTags(recipe) {
  const title = repairTitle(recipe.title);
  const headnote = recipe.headnote || "";
  const tags = [];
  for (const course of COURSES) {
    if (course.exclude.length && hasAny(title, course.exclude)) continue;
    const suffixHit = (course.suffix || []).some((s) =>
      new RegExp(`\\b\\w+${escapeRe(s)}s?\\b`, "i").test(title)
    );
    const hit =
      hasAny(title, course.include) ||
      suffixHit ||
      (course.headnote.length && hasAny(headnote, course.headnote));
    if (hit) tags.push({ slug: slugify(course.label), label: course.label });
  }
  return tags;
}

// --- Diet tags ------------------------------------------------------------
// These come from the books themselves (recipe.diet_tags), so they're recorded
// fact rather than a guess — far better than inferring "gluten-free" from the
// absence of flour. A few entries in that field describe effort rather than
// diet, so they're routed to the effort category instead.

const DIET_LABELS = {
  "gluten-free": "Gluten-Free",
  "soy-free": "Soy-Free",
  "nut-free": "Nut-Free",
  "oil-free": "Oil-Free",
  "sugar-free": "Sugar-Free",
  "grain-free": "Grain-Free",
  raw: "Raw",
};

const EFFORT_FROM_DIET = {
  "one-pot": "One Pot",
  "no-bake": "No Bake",
  "freezer-friendly": "Freezer Friendly",
  quick: null, // already covered by the time buckets
};

function dietTags(recipe) {
  const tags = [];
  for (const raw of recipe.diet_tags || []) {
    const label = DIET_LABELS[raw];
    if (label) tags.push({ slug: slugify(label), label });
  }
  // The title is the other reliable source — a book that prints "Gluten-Free
  // Cornbread" is making the same claim its metadata would.
  const title = repairTitle(recipe.title);
  if (/gluten[- ]free/i.test(title)) tags.push({ slug: "gluten-free", label: "Gluten-Free" });
  if (/\braw\b/i.test(title)) tags.push({ slug: "raw", label: "Raw" });
  if (/oil[- ]free/i.test(title)) tags.push({ slug: "oil-free", label: "Oil-Free" });
  return tags;
}

// --- Effort tags ----------------------------------------------------------

function effortTags(recipe) {
  const title = repairTitle(recipe.title);
  const book = recipe.source_book || "";
  const text = `${title} ${book}`;
  const steps = (recipe.steps || []).length;
  const count = recipe.ingredient_count || 0;
  const tags = [];

  for (const raw of recipe.diet_tags || []) {
    const label = EFFORT_FROM_DIET[raw];
    if (label) tags.push({ slug: slugify(label), label });
  }

  if (/\bone[- ]pot\b|\bone[- ]pan\b|\bsheet[- ]pan\b|\bskillet\b|\bdutch oven\b|\binstant pot\b|\bslow cooker\b|\bair fryer\b/i.test(text)) {
    tags.push({ slug: "one-pot", label: "One Pot" });
  }
  if (/\bno[- ]bake\b/i.test(text)) tags.push({ slug: "no-bake", label: "No Bake" });

  // Guarded by count > 0 so a recipe whose ingredients failed to parse doesn't
  // land in the "5 ingredients" deck by looking empty.
  if (count > 0 && count <= 5) tags.push({ slug: "5-ingredients-or-fewer", label: "5 Ingredients or Fewer" });
  if (count > 0 && count <= 8 && steps > 0 && steps <= 4) {
    tags.push({ slug: "beginner-friendly", label: "Beginner Friendly" });
  }

  return tags;
}

// --- Season & occasion tags -----------------------------------------------

const SEASONS = [
  {
    label: "Holiday",
    strong: ["thanksgiving", "christmas", "holiday", "easter", "halloween", "hanukkah", "new year", "valentine", "festive"],
    weak: ["cranberry", "eggnog", "gingerbread", "pumpkin pie", "stuffing", "yule"],
  },
  {
    label: "Summer",
    strong: ["summer", "grill", "grilled", "barbecue", "bbq", "picnic", "popsicle", "ice pop", "lemonade", "cookout"],
    weak: ["chilled", "refreshing", "watermelon", "corn on the cob", "gazpacho"],
  },
  {
    label: "Cozy",
    strong: ["cozy", "comfort", "warming", "hearty"],
    weak: ["pumpkin", "butternut", "stew", "chili", "pot pie", "casserole", "hot chocolate", "cider", "roast"],
  },
  {
    label: "Spring",
    strong: ["spring"],
    weak: ["asparagus", "rhubarb", "ramp", "artichoke", "english pea", "fava"],
  },
  {
    label: "Party",
    strong: ["party", "potluck", "game day", "super bowl", "crowd", "platter"],
    weak: ["dip", "slider", "appetizer", "finger food", "pitcher"],
  },
];

function seasonTags(recipe) {
  const title = repairTitle(recipe.title);
  const headnote = recipe.headnote || "";
  const tags = [];
  for (const s of SEASONS) {
    // A strong word anywhere, or a weak word in the title. Weak words in a
    // headnote are too incidental to act on ("serve this at your next party").
    const hit =
      hasAny(title, s.strong) || hasAny(headnote, s.strong) || hasAny(title, s.weak);
    if (hit) tags.push({ slug: slugify(s.label), label: s.label });
  }
  return tags;
}

// --- Book tags ------------------------------------------------------------
// One per recipe, straight from source_book — exact metadata, not a guess.

function bookTag(recipe) {
  if (!recipe.source_book) return null;
  return { slug: slugify(recipe.source_book), label: recipe.source_book };
}

// --- Main -----------------------------------------------------------------

function buildRows(recipes) {
  const rows = [];
  const push = (recipe, category, tag) =>
    rows.push({ recipe_id: recipe.id, category, tag_slug: tag.slug, label: tag.label });

  for (const recipe of recipes) {
    const time = timeTag(recipe);
    if (time) push(recipe, "time", time);

    for (const tag of ingredientTags(recipe)) push(recipe, "ingredient", tag);
    for (const tag of cuisineTags(recipe)) push(recipe, "cuisine", tag);
    for (const tag of courseTags(recipe)) push(recipe, "course", tag);
    for (const tag of dietTags(recipe)) push(recipe, "diet", tag);
    for (const tag of effortTags(recipe)) push(recipe, "effort", tag);
    for (const tag of seasonTags(recipe)) push(recipe, "season", tag);

    const book = bookTag(recipe);
    if (book) push(recipe, "book", book);
  }

  // dietTags can emit the same tag from both metadata and the title.
  const seen = new Set();
  return rows.filter((r) => {
    const key = `${r.recipe_id}|${r.category}|${r.tag_slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Must stay in sync with the CHECK constraint on recipe_tags.category — see
// scripts/schema-recipe-tags-categories.sql. Rows in any other category are
// held back rather than allowed to fail the whole insert: replaceAllRows has
// already deleted everything by that point, so one rejected row would
// otherwise leave the table empty and the app's category browsing dead.
// Adding a category here means running the ALTER first.
const ALLOWED_CATEGORIES = new Set([
  "time",
  "cuisine",
  "ingredient",
  "course",
  "book",
  "diet",
  "effort",
  "season",
]);

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

function summarize(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = `${row.category}:${row.label}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function printSummary(rows) {
  const sorted = summarize(rows);
  console.log(`\n${rows.length} tag rows across ${sorted.length} distinct tags:`);
  for (const [key, count] of sorted) console.log(`  ${key}: ${count}`);
}

// Reads the live table so a dry run can show what would actually change,
// rather than just what the new logic produces in isolation.
async function fetchExistingRows() {
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("recipe_tags")
      .select("recipe_id,category,tag_slug,label")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read recipe_tags: ${error.message}`);
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

function writeReport(recipes, rows, existing) {
  const byRecipe = new Map();
  for (const r of rows) {
    if (!byRecipe.has(r.recipe_id)) byRecipe.set(r.recipe_id, []);
    byRecipe.get(r.recipe_id).push(`${r.category}:${r.tag_slug}`);
  }

  const lines = [];
  lines.push(`Computed ${rows.length} tag rows for ${recipes.length} recipes.\n`);
  lines.push("=== tag counts ===");
  for (const [key, count] of summarize(rows)) lines.push(`  ${key}: ${count}`);

  if (existing) {
    const key = (r) => `${r.recipe_id}|${r.category}|${r.tag_slug}`;
    const before = new Set(existing.map(key));
    const after = new Set(rows.map(key));
    const added = [...after].filter((k) => !before.has(k));
    const removed = [...before].filter((k) => !after.has(k));
    lines.push(`\n=== diff vs live table ===`);
    lines.push(`  live rows: ${existing.length}   new rows: ${rows.length}`);
    lines.push(`  added: ${added.length}   removed: ${removed.length}`);

    const bucket = (keys) => {
      const m = new Map();
      for (const k of keys) {
        const [, category, slug] = k.split("|");
        const kk = `${category}:${slug}`;
        m.set(kk, (m.get(kk) || 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    lines.push(`\n  biggest additions:`);
    for (const [k, n] of bucket(added).slice(0, 25)) lines.push(`    +${n}  ${k}`);
    lines.push(`\n  biggest removals:`);
    for (const [k, n] of bucket(removed).slice(0, 25)) lines.push(`    -${n}  ${k}`);
  }

  lines.push(`\n=== every recipe and its tags ===`);
  for (const recipe of recipes) {
    const tags = byRecipe.get(recipe.id) || [];
    lines.push(`${repairTitle(recipe.title)}  [${recipe.source_book}]`);
    lines.push(`    ${tags.length ? tags.join("  ") : "(no tags)"}`);
  }

  fs.writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
}

async function main() {
  const recipes = JSON.parse(fs.readFileSync(BUNDLE_PATH, "utf8"));
  const rows = buildRows(recipes);

  if (DRY_RUN) {
    let existing = null;
    try {
      existing = await fetchExistingRows();
    } catch (err) {
      console.warn(`(couldn't read the live table for a diff: ${err.message})`);
    }
    writeReport(recipes, rows, existing);
    printSummary(rows);
    console.log(`\nDRY RUN — nothing was written. Full report: ${REPORT_PATH}`);
    if (existing) {
      const key = (r) => `${r.recipe_id}|${r.category}|${r.tag_slug}`;
      const before = new Set(existing.map(key));
      const after = new Set(rows.map(key));
      console.log(
        `Live table has ${existing.length} rows; this would add ` +
          `${[...after].filter((k) => !before.has(k)).length} and remove ` +
          `${[...before].filter((k) => !after.has(k)).length}.`
      );
    }
    return;
  }

  const writable = rows.filter((r) => ALLOWED_CATEGORIES.has(r.category));
  const held = rows.filter((r) => !ALLOWED_CATEGORIES.has(r.category));

  await replaceAllRows(writable);
  printSummary(writable);
  console.log(`\nTagged ${recipes.length} recipes — wrote ${writable.length} rows.`);

  if (held.length) {
    const cats = [...new Set(held.map((r) => r.category))].sort();
    console.log(
      `\n${held.length} rows in categories [${cats.join(", ")}] were NOT written: the ` +
        `recipe_tags.category CHECK constraint doesn't allow them yet.\n` +
        `Run scripts/schema-recipe-tags-categories.sql in the Supabase SQL editor, add those ` +
        `names to ALLOWED_CATEGORIES above, and re-run this script.`
    );
  }
  console.log("\nRe-run build-swipe-decks.mjs next — the auto decks are built from these tags.");
}

main();
