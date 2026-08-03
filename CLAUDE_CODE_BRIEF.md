# Project brief: vegan recipe swipe app

## What we're building

A private household app for two people (Cameron and his wife) to stop planning meals from
scratch each week. Recipes are extracted from a personal library of 61 vegan cookbooks
(EPUB). The interaction model is Tinder-style: swipe through recipe cards, and when **both**
people swipe right the recipe becomes a match and lands in the week's meal plan.

Not a commercial product. Two users, one household. Do not add auth flows, onboarding,
analytics, or subscription scaffolding.

## Current state

The extraction pipeline is built and working. 5 of 61 books are processed:
**865 recipes, 9,586 ingredients, 92% parsed with no warnings.** The remaining 56 books
run through the same pipeline unchanged.

Existing files (treat these as inputs, not things to rewrite):

| File | Purpose |
|---|---|
| `recipes_metric.json` | 865 recipes, fully structured. The app's data source. |
| `density_table.json` | 1,290 volume→mass conversions, self-describing. Load, don't rebuild. |
| `density_curated.json` | Hand-maintained liquid densities and produce weights. Edit this to fix gaps. |
| `extract.py` | EPUB → structured recipes. Infers each book's CSS conventions automatically. |
| `build_density.py` | Mines densities from books' own gram figures. |
| `apply_metric.py` | Adds gram figures to every ingredient. |

## Data schema

Recipe:

```
id                 stable 12-char hash of book+title
title              e.g. "Falafel Bowl with Israeli Couscous"
source_book        book title
source_file        path inside the epub (for tracing back)
authors            list
servings           float, nullable
servings_text      e.g. "APPROXIMATELY 4 CUPS (740 G)"
time_text          e.g. "50 minutes to prepare" — ONLY 138 of 865 have this
diet_tags          ["nut-free", "soy-free", ...]
headnote           author's intro prose (842 of 865)
ingredient_groups  [{ name: "for the sauce" | null, ingredients: [...] }]
steps              array of strings, median 4
notes              array of strings
nutrition          raw string (114 of 865)
ingredient_count   int
weighable_count    int — ingredients a scale can resolve
total_grams        float
confidence         0.0–1.0
warnings           array of strings, empty for 92%
```

Ingredient:

```
raw                original line, always preserved
quantity           float — 0.25, 1.5
quantity_text      "1 1/2"
unit               "cup", "tbsp", null for count items
metric             publisher's figure, e.g. "312 g"
package_metric     from can/jar brackets, e.g. "414 ml"
item               "all-purpose flour"
prep               "sifted", "finely chopped"
optional           bool
grams              float, nullable — 77% populated
grams_source       "book" | "book-package" | "density:<key>" | "approx-each:<key>" | ...
grams_confidence   "high" | "medium" | "low"
weighable          bool — true when grams >= 5 and not approximate
approx             bool — count-based estimate, don't present as exact
display            preformatted string: grams if weighable, else raw
```

### Rules the UI must respect

- **`weighable == false` → show `raw`, not grams.** A 1 g scale can't resolve ¼ tsp of
  baking soda (1.2 g). Never ask someone to weigh a pinch.
- **`approx == true` → prefix with `~` or show the count.** These are bulk-produce estimates
  for shopping-list totals, not measurements.
- **`ingredient_groups` with a `name` are sub-recipes** ("for the crust", "for the filling").
  224 recipes have them. Keep them visually distinct — flattening them makes recipes unusable.
- **`raw` is the source of truth.** Every derived field can be wrong; `raw` never is. Show it
  on demand.

## Product decisions already made

- **Matching:** both users must swipe right. One person's yes is not a match.
- **Sync:** data lives synced between both phones, not device-local.
- **Feature priority:** (1) weekly meal plan calendar, (2) ratings & notes history,
  (3) recipe editing and scaling, (4) shopping lists. Build in that order.

## Recommended architecture

React PWA, installable to an Android home screen. No Play Store — it buys nothing for a
two-person tool, and the recipe data ports to React Native later if wanted.

Sync needs a backend. Firebase or Supabase free tier is sufficient; two users, ~2,000
recipes, low write volume. Recipes are read-only reference data — ship them as a static
bundle and keep only user state (swipes, matches, plans, ratings, notes, edits) in the
backend. That keeps the sync surface small.

Suggested state split:

```
static bundle   recipes, density table          — read-only, versioned with the app
synced          swipes, matches, meal plan,     — small, two writers
                ratings, notes, recipe edits
local cache     last-known synced state         — app must work offline in a kitchen
```

Recipe edits should be stored as overlays keyed by recipe id, never mutations of the source
data. Re-running extraction on the library must not wipe someone's tweaks.

## Build order

1. **Data layer + swipe deck.** Load the bundle, card stack with drag gestures, record
   swipes per user. Card front shows image, title, cook/prep time, ingredient count.
2. **Match detection + weekly calendar.** Both-right → match → assign to a day. This is the
   feature that replaces the weekly planning conversation, so it's the one that has to feel good.
3. **Recipe detail view.** Ingredient groups, weighable-vs-spoon display, steps, headnote,
   scale-by-servings control.
4. **Ratings and notes.** Post-cook rating, freeform notes, history.
5. **Shopping list.** Aggregate `item` + `grams` across the week's plan, group by aisle,
   merge duplicates. The structured ingredient data exists for exactly this.

## Known gaps to handle

- **No images extracted yet.** The epubs contain them (76–509 per book) at
  `OEBPS/images/*.jpg`, referenced from each recipe's `source_file`. Swipe cards need these,
  so extracting and associating them is a prerequisite for step 1. Match by parsing the
  `<img>` in the recipe's source document.
- **Prep/cook times are mostly missing.** Only 138 of 865 recipes state a time. The card
  design assumes both prep and cook time. Options: infer from method text (durations are
  usually in the steps), or drop the fields from the card. Decide before building the card.
- **Sub-recipes counted as standalone recipes.** The Ultimate Vegan Cookbook yields 556
  "recipes", but some are component sauces given their own heading. Without a filter the deck
  will offer "cashew cream" as a dinner. Heuristic: few ingredients, no image, title matches a
  component word, and referenced from another recipe.
- **66 recipes carry warnings.** Mostly "no servings found" where the book never states a
  yield. Surface `warnings` in the detail view rather than hiding them.
- **56 books still to ingest.** Expect some to need new curated densities and possibly
  per-book overrides. Fixed-layout (image-only) books would need OCR; none of the first five were.

## Constraints

Private household use. The recipe text and images are the authors' copyrighted work — the app
must not be published with the extracted content bundled in, made publicly accessible, or
distributed beyond these two users. Keep the repo private.
