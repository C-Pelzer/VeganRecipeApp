# Vegan Recipe Swipe App

A private, two-person meal-planning app. Recipes are extracted from a personal library of
vegan cookbooks; the interaction model is Tinder-style — swipe through recipe cards, and when
**both** people swipe right, the recipe becomes a match and lands in the week's meal plan.

> **This repo is private and must stay that way.** The recipe text and images are the source
> cookbooks' copyrighted content. Don't publish this repo, deploy the app somewhere publicly
> accessible, or distribute the extracted content beyond the two household members it's for.

## Status

- **Extraction pipeline:** working. 5 of 61 books processed — 865 recipes, 9,586 ingredients,
  92% parsed with no warnings. The remaining 56 books run through the same pipeline unchanged.
- **App:** step 1 of the build order is done — data layer, image extraction, and the swipe
  deck are built and synced through Supabase. Match detection, the weekly calendar, the recipe
  detail view, ratings/notes, and the shopping list are not built yet (see Roadmap below).

## How it fits together

```
Python pipeline (repo root)          Node data-prep (scripts/)         React PWA (app/)
─────────────────────────           ──────────────────────           ─────────────────
extract.py         epub -> recipes   extract-images.mjs                Swipe deck, synced
apply_metric.py    + gram figures     + build-bundle.mjs   ──────►     via Supabase, cached
build_density.py   density mining         │                            offline for kitchen use
        │                                 ▼
        ▼                          app/public/data/recipes.json
recipes_metric.json                app/public/images/recipes/*.jpg
(source of truth,
 865 recipes)
```

- The **Python pipeline** turns raw EPUBs into structured recipe JSON. It's treated as a
  stable input — see `CLAUDE_CODE_BRIEF.md` for the full data schema and the product decisions
  behind it.
- The **Node scripts** pull each recipe's hero photo out of its source EPUB (resized/re-encoded
  to keep repo size sane — full-res book photos are several MB each; these get downscaled to a
  max 1200px width, ~78% JPEG quality), flag likely sub-recipes (sauces, crusts, dressings that
  shouldn't be offered as a standalone dinner), and merge everything into the bundle the app
  fetches at runtime.
- The **app** is a React PWA (installable to an Android home screen, no Play Store). Recipes
  ship as a static, versioned bundle; only user state (swipes, matches, plans, ratings, notes)
  syncs through Supabase, since that's the only part that actually needs two writers.

## Repo layout

```
extract.py, apply_metric.py,      Python extraction pipeline — inputs, not to be rewritten
build_density.py
recipes_metric.json               865 recipes, fully structured (the pipeline's output)
density_table.json,               Volume->mass conversion data the pipeline consumes
density_curated.json
CLAUDE_CODE_BRIEF.md               Full data schema, product decisions, build order, known gaps

scripts/                          Node data-prep (epub images -> app bundle)
  extract-images.mjs
  build-bundle.mjs
  image-manifest.json              generated: recipe id -> image path

app/                               The React PWA
  src/
    types/recipe.ts                 TS types mirroring the documented schema
    lib/store/                      SyncStore interface + Supabase-backed implementation
    lib/data.ts                     fetches/caches the recipe bundle
    lib/profile.ts                  "who's swiping" device picker (not auth)
    features/deck/                  swipe card stack + drag gestures
    features/profile/               profile picker screen
  public/data/recipes.json          generated: the bundle the app fetches
  public/images/recipes/*.jpg       generated: per-recipe hero photos
  TESTING.md                        full manual test walkthrough (desktop + phone)
```

## Running it

**Data prep** (only needed after re-running the Python pipeline on more books):
```
cd scripts
node extract-images.mjs
node build-bundle.mjs
```

**The app:**
```
cd app
npm install
npm run dev
```
Needs `app/.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see
`app/.env.example`) — ask Cameron for these, they're not committed.

See `app/TESTING.md` for a full walkthrough (desktop smoke test, phone install, offline check).

## Data & sync model

- **Recipes are read-only reference data** — bundled as static JSON, versioned with the app,
  never written back to.
- **User state** (swipes, and eventually matches/plans/ratings/notes/recipe edits) is what
  actually syncs, via Supabase. Writes land locally first so swiping never blocks on network;
  a failed sync queues and retries on the next network-touching call, so a swipe made offline
  in the kitchen isn't lost.
- There's no login — a one-tap "which of us is this" picker on first load remembers the
  choice per device (see brief: no auth flows for a two-person household tool).

## Roadmap

Per `CLAUDE_CODE_BRIEF.md`'s build order:

1. ~~Data layer + swipe deck~~ — done
2. Match detection + weekly calendar — next
3. Recipe detail view (ingredient groups, weighable-vs-spoon display, scale-by-servings)
4. Ratings and notes
5. Shopping list

Plus the ongoing work of processing the remaining 56 books through the existing pipeline.
