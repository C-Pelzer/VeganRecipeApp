# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Started as a private two-person household app (Cameron and Mallorie) and is now opening up to
friends and family: anyone can sign in with their own Google account and create or join a
household. Recipes are extracted from a personal library of copyrighted vegan cookbooks (EPUB) —
the recipe corpus itself is still not for redistribution, but the deployed app is no longer
limited to two named people. Not a commercial product: no payment, subscriptions, or analytics —
sign-in exists to give each household its own private data, not to monetize or track anyone. See
`README.md` and `CLAUDE_CODE_BRIEF.md` for the full product brief, data schema, and original build
order — `CLAUDE_CODE_BRIEF.md`'s "Roadmap"/"Build order" sections are historical; the actual
feature set has grown well past them (see Architecture below).

## Repo layout — three pipelines feeding one app

```
repo root (Python)        scripts/ (Node)              app/ (React PWA)
extract.py, apply_metric.py, build_density.py  ->  extract-images.mjs, build-bundle.mjs,
recipes_metric.json (source of truth)              tag-recipes.mjs, build-swipe-decks.mjs
                                                    -> app/public/data/recipes.json
                                                       app/public/images/recipes/*.jpg
```

- **Python pipeline** (repo root): EPUB → structured recipe JSON. Treat `extract.py`,
  `apply_metric.py`, `build_density.py`, and their output (`recipes_metric.json`,
  `density_table.json`, `density_curated.json`) as stable inputs, not things to rewrite. Full
  data schema (Recipe/Ingredient field meanings, the rules the UI must respect around
  `weighable`/`approx`/`ingredient_groups`) is documented in `CLAUDE_CODE_BRIEF.md` — read it
  before touching anything that consumes `recipes_metric.json` or `Recipe`/`Ingredient` types.
- **Node data-prep** (`scripts/`): pulls hero photos out of source EPUBs, uploads them to
  Supabase Storage, tags recipes, builds the auto swipe decks, and merges everything into the
  bundle the app fetches at runtime. Only needs re-running after the Python pipeline processes
  more books, or after a tagging/deck-building heuristic changes.
- **App** (`app/`): the React PWA — see Architecture below.

## Commands

```
# App (from app/)
npm install
npm run dev              # vite dev server — prints a Network URL for phone testing
npm run build             # tsc -b && vite build
npm run lint               # oxlint
npm run preview

# Data prep (from scripts/, only after re-running the Python pipeline or changing tagging/deck logic)
node extract-images.mjs
node --env-file=.env upload-images.mjs
node --env-file=.env build-bundle.mjs
node --env-file=.env tag-recipes.mjs
node --env-file=.env build-swipe-decks.mjs
```

No automated test suite exists — `app/TESTING.md` is a manual walkthrough (desktop smoke test,
two-person favorite/shared check, phone install + offline check). Run through the relevant
section by hand after UI changes; there's no `npm test` to reach for instead.

`app/.env.local` needs `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `.env.example`);
`scripts/.env` needs `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Ask Cameron for real values — not
committed.

Deploys to Cloudflare Workers (static assets from `app/dist`, `app/wrangler.jsonc`). It's
configured with `not_found_handling: "single-page-application"` deliberately instead of a
`_redirects` blanket rewrite — a `/* -> /` rule would intercept real asset paths too (see the
comment in `wrangler.jsonc`).

## Architecture

**State split**: recipes are read-only static data (`app/public/data/recipes.json`, generated,
never written back to); everything else syncs through Supabase, scoped per household.

**Auth & households**: real Supabase Auth via Google OAuth (`src/lib/auth.tsx` — `AuthProvider`/
`useAuth()`, plus `getCurrentHouseholdId()`/`getCurrentProfile()` ambient accessors for store
modules, which aren't React components). A `profiles` row is auto-provisioned per Google account
(trigger in `scripts/schema-auth.sql`); a `households` row groups any number of profiles, joined
via a shared invite code (`create_household`/`join_household` RPCs). `App.tsx` gates on session →
household in that order: signed out shows `SignInScreen`, signed in with no household shows
`HouseholdOnboardingScreen`, otherwise the app renders normally with `currentUser` now meaning "my
`profiles.id`" rather than a literal `'Cameron'`/`'Mallorie'` string. Every synced table's RLS is
scoped to `household_id = current_household_id()` (see `scripts/reset-to-household-schema.sql`,
which wipes the pre-household-auth data on the nine existing tables rather than migrating it —
a deliberate choice to start the first household fresh via normal sign-up) — a new table follows
the same pattern:
add `household_id uuid not null references households (id)`, scope its RLS policy through
`current_household_id()`, and if it has any natural/composite primary key, make sure `household_id`
is part of it (two households must never collide on the same key).

**Store pattern**: each synced feature has its own store module under `src/lib/store/`
(`deckStore.ts`, `mealCalendarStore.ts`, `mealPlanStore.ts`, `shoppingListStore.ts`,
`recipeOverrideStore.ts`, `recipePhotoStore.ts`, `recipeTagOverrideStore.ts`,
`importedRecipeStore.ts`), each talking to one or two Supabase tables directly (row ↔ domain-type
mapper functions, no ORM). The one exception is swipes/favorites: `SyncStore`
(`src/lib/store/types.ts`) is a real interface with two implementations —
`SupabaseStore` (`supabaseStore.ts`, the one actually wired up) wraps a `LocalStore`
(`localStore.ts`) as both an offline read cache and a durable pending-write queue, so a swipe
made offline in the kitchen isn't lost and never blocks the UI on network. Priority/favorite
arithmetic happens atomically server-side via the `apply_swipe` Postgres RPC, not client-side, so
two devices hitting the same row can't race.

**Recipe pool tables**, all keyed by `recipe_id` and additive over the static bundle — never
mutate `recipes.json` itself:
- `recipe_priority` / `swipe_events` — per-user priority (starts at 5, ±1 per swipe, favorited is
  sticky once set), swipe history. Swiped recipes *resurface*, they aren't one-shot.
- `recipe_tags` (pipeline-computed, `scripts/tag-recipes.mjs`) + `recipe_tag_overrides`
  (user add/remove edits) — merged client-side in `src/lib/tags.ts`
  (`effectiveTagsByRecipe`), mirroring the same merge `build-swipe-decks.mjs` does server-side.
- `swipe_decks` / `swipe_deck_recipes` / `swipe_deck_shares` — persisted decks, capped at 40
  recipes each. `source: 'auto'` decks are one per tag (rebuilt by `build-swipe-decks.mjs`,
  global — readable by every signed-in user, not household-scoped, since they're derived from the
  shared recipe pool); `source: 'manual'` decks are household-owned and hand-built in the Catalog,
  and can be shared to any other member of the same household. `'new'`/`'everything'`
  (`src/features/deck/decks.ts`) are the only two decks that stay live pool filters rather than
  persisted rows.
- `recipe_overrides`, `recipe_photos`, `imported_recipes`, `meal_plan_items`,
  `meal_calendar_entries`, `shopping_list_items` — one Supabase table each, self-explanatory from
  their store module. Schema for every table lives in `scripts/schema-*.sql`.

**Recipe import** (`src/features/importRecipe/`, `src/lib/recipeImport/`): pastes/fetches a
recipe blog URL, scans the HTML for schema.org `Recipe` JSON-LD, and maps it into the same
`Recipe`/`Ingredient` shape the book pipeline produces (`mapToRecipe.ts`, `parseIngredientLine.ts`,
`parseJsonLd.ts`) so imported recipes are indistinguishable from book recipes everywhere else in
the app. `supabase/functions/fetch-page` is a Deno Edge Function proxy for the parts a browser
can't do directly: fetching the page HTML (most recipe sites lack CORS headers), downscaling/
re-uploading recipe and post-cook photos, and resizing camera photos server-side (a raw
phone-camera photo can crash client-side canvas resize on real Android hardware). Manually
added recipes (no source URL) go through `AddRecipeScreen`/`buildManualRecipe.ts` instead.

**Types**: `src/types/recipe.ts` is the single source of truth for every domain shape and mirrors
`CLAUDE_CODE_BRIEF.md`'s documented schema — keep the two in sync, and keep it in sync with
whatever `scripts/build-bundle.mjs` actually emits for the `Recipe`/`Ingredient` fields.

**PWA/offline**: `vite-plugin-pwa` (`vite.config.ts`) CacheFirst-caches the recipe data bundle and
Supabase Storage recipe images so the deck works with no signal in the kitchen. Bump this config
thoughtfully — it's what `TESTING.md`'s airplane-mode check verifies.

## Working conventions specific to this repo

- **No `supabase/migrations` or linked CLI** — schema changes are applied by hand. When a task
  needs a new table, write `scripts/schema-<name>.sql` matching the existing tables' conventions
  (plain `text` columns, composite primary keys over surrogate ids when a row is naturally unique
  by its data, `not null default ''` / `default now()` over nullable columns), hand it to Cameron
  to run in the Supabase SQL editor, and wait for his confirmation before writing or reading any
  data through it. Since the household-auth migration, new tables are `household_id`-scoped and
  RLS-restricted to `authenticated` via `current_household_id()` (see Architecture above), not the
  old blanket `anon full access` policy — that pattern only survives on the `auto`-source rows of
  `swipe_decks`, which are genuinely global reference data.
- **No staging Supabase project** — it's the one real database the household actually uses.
  Any manual/Playwright verification that swipes, favorites, checks a shopping-list box, or adds
  a recipe writes real data. Prefer verification paths that don't require real writes when
  possible; when a write is unavoidable, confirm the exact row touched by reading the specific
  element's own state (not a same-looking element elsewhere in the DOM — card stack order in
  particular is reversed: `DeckScreen` renders via `visible.slice().reverse().map(...)`, so the
  top-of-stack card is *last* in DOM order) and re-query after cleanup to confirm, rather than
  trusting an assumed mapping or an HTTP status code.
- **Two separate `category` CHECK constraints** guard `recipe_tags.category` and
  `swipe_decks.category`, and the live database has drifted from the `schema-*.sql` files (the
  live `swipe_decks` allows `book`, which `schema-swipe-decks.sql` doesn't list). Both scripts
  delete-then-insert, so a rejected row after the delete leaves the table **empty** — this
  happened, and it wiped `recipe_tags` mid-run. Before any delete-then-insert against a
  constrained column, probe the live constraint with a throwaway row (insert, then delete it,
  then confirm 0 remain) rather than trusting the schema file. Both scripts now hold back rows
  in disallowed categories instead of failing the batch; `ALLOWED_CATEGORIES` /
  `ALLOWED_DECK_CATEGORIES` must be widened by hand *after* the matching `alter table` is run.
- **Deploys ship from GitHub**, not `wrangler deploy` — pushing to `main` triggers the Cloudflare
  build. There are no wrangler credentials on Cameron's machine, so a manual deploy just fails on
  auth. The one exception is `supabase/functions/fetch-page`, which is **not** part of that build
  and has to be pasted into the Supabase dashboard by hand.

## Current state (as of 2026-08-17)

**Google auth + households** is fully live: the app code shipped (`src/lib/auth.tsx`,
`SignInScreen`/`HouseholdOnboardingScreen`, every store module widened to carry `household_id`),
Google OAuth is configured, and **both Supabase scripts have been run against production** —
`scripts/schema-auth.sql` then `scripts/reset-to-household-schema.sql`. As designed, that reset
wiped the nine tables' data (recipe priorities/swipes, decks, meal calendar, shopping list,
imported recipes, photos, tag/recipe overrides) rather than migrating Cameron/Mallorie's rows —
the first household was started fresh through normal sign-up. Deferred follow-ups (household
management UI, N-way deck-sharing redesign, sign-up abuse consideration) are tracked as
`NewIdeas.txt` item 1a–1c.

Two things had to be repaired after that migration, both worth knowing about:
- **Auto decks had to be rebuilt.** `truncate table swipe_decks cascade` empties auto decks along
  with everything else, and nothing restores them automatically — re-run
  `node --env-file=.env build-swipe-decks.mjs`. `recipe_tags` is *not* in the truncate list, so
  the source data survives and no re-tagging is needed. Hand-built `source: 'manual'` decks are
  genuinely unrecoverable.
- **`recipe_tags` needed its own `authenticated` policy** (`scripts/schema-recipe-tags-auth.sql`).
  The reset script swaps `anon full access` for a `current_household_id()`-scoped `authenticated`
  policy on the twelve tables it touches, but `recipe_tags` was never in that list — it's global
  reference data, correctly not household-scoped, and so was left anon-only with RLS still on.
  Postgres policies apply per-role and `authenticated` does not inherit `anon`, so the signed-in
  app silently read back **zero tags** while the table was full. Worth remembering as a general
  trap: a batch script using the anon key and the signed-in app see different rows, so "the script
  can read it" is not evidence the app can.

**Shopping list** rows are stored one per `(item_key, unit_key)` as before, but everything above
that is now a read-layer concern in `app/src/lib/shoppingListMath.ts`: summed quantities render
as kitchen fractions (rounded *up* — under-buying costs a second trip), unit-less counts round up
to whole items, compatible units convert within a family (tsp/tbsp/cup, ml/l, oz/lb, g/kg) so one
ingredient is one row, and items are grouped into store aisles. Pantry staples render in a
separate collapsed section **with no quantity at all** — "2¼ tsp sea salt" is arithmetically true
and useless to shop from. Two heuristics drive this: `isPantryStaple` is deliberately
conservative (a misfiled produce item is a missed purchase), while `classifyAisle` can be broad
(every aisle renders expanded, so a wrong heading is only cosmetic). Both must cope with the
extractor leaving packaging and prep words in the item name — `can black beans` is a canned good,
not dry beans.

**Recipe titles** are repaired at load time in `app/src/lib/recipeTitle.ts`, called once from
`loadStaticRecipes()` in `lib/data.ts` so search, sorting and deck building all see the cleaned
string. `recipes.json` is generated and stays untouched. It fixes three things, and is
deliberately conservative — a title that already contains lowercase is left completely alone:
1,750 ALL-CAPS titles title-cased (casing is per-book: every book is ~100% or ~0% caps), 75
drop-cap splits rejoined (`V ANILLA Y OGURT`, an EPUB decorative first letter in its own span),
and 59 La Vida Verde titles unwrapped from parentheses (the extractor kept only the English
translation and dropped the Spanish name).

**Known-unfixable title damage**, recorded in `NewIdeas.txt`: 68 recipes whose title is a yield
line (`SERVES 2`, mostly Effortless Vegan) — the real name was never extracted, and each sits
alone in its own source file, so it can't be recovered from the bundle; and 767 partially-capsed
titles where the book capitalises the hero ingredient on purpose (`Easy Red Lentil DAL`), left
alone since flattening them would wreck real acronyms. **The source EPUBs are no longer in the
repo**, so nothing can be re-extracted until they're located.

**Tagging** (`scripts/tag-recipes.mjs`) was reworked from boolean any-keyword-matching to
evidence-weighted matching: ingredients match the parsed ingredient list with real plural forms
(`-es`/`-ies`, not `s?`) longest-phrase-first with masking so `sweet potato` blocks `potato`;
cuisine keywords split strong/weak so a Thai curry isn't also Indian; course keywords carry
exclusions so Shepherd's Pie isn't a dessert; title evidence outweighs headnote evidence.
Categories `diet` (from the books' own `diet_tags`, not inferred), `effort` and `season` were
added. Run `--dry-run` first — it writes `scripts/tag-report.txt` and diffs against the live
table without writing. `build-swipe-decks.mjs` must be re-run afterwards.

**Not yet done**: the UI pass. An audit found the nav is 8 drawer destinations reached through a
~16px `☰` target; the header is hand-rolled in all 9 screens with drifting spacing; the recipe
list row is duplicated 5×; every text input is 14px, which force-zooms Safari on focus;
`index.css` has no design tokens at all, so colours and radii are retyped per file (four
different primary button styles); and `DecksHomeScreen`/`FavoritesScreen`/`MealCalendarScreen`
have fetches with no `.catch`, so a failure sits on "Loading…" forever. Meal Calendar is the
worst screen — colored bars with no meal names and no breakfast/lunch/dinner row labels.
