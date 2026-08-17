# Testing the app

## 1. Rebuild the data bundle (only needed after touching the pipeline/scripts)

```
cd scripts
node extract-images.mjs                        # -> image-manifest.json + app/public/images/recipes/*
node --env-file=.env upload-images.mjs          # -> pushes images to Supabase Storage
node --env-file=.env build-bundle.mjs           # -> app/public/data/recipes.json
```

Already run for all 61 books — skip this unless you re-run `extract.py`/`apply_metric.py` upstream.

## 2. Start the dev server

```
cd app
npm run dev
```

Vite prints two URLs: a `localhost` one and a `Network` one. The Network one is what your
phone needs — it looks like `http://192.168.0.4:5173` (this machine's current LAN IP; Vite
will print whatever's current).

## 3. Test on desktop first (fastest feedback loop)

Open the `localhost` URL in a browser.

- **Sign in with Google** shows on first load. On success, if your account isn't in a household
  yet you land on the household screen — create one, or join an existing one with its invite
  code (shown in the nav drawer once you're in).
- **Deck** loads with a counter (`0 / 4741`) and a deck picker at the top (**New** / **Everything**).
  - **New** only shows recipes you've never swiped.
  - **Everything** shows all eligible recipes, including ones you've swiped before — recipes
    aren't retired after one swipe anymore, they resurface until removed.
- **Three actions** per card, both by button and by drag:
  - ✕ / drag left — pass. Priority -1.
  - ♥ / drag right — favorite. Priority +1, and it's now sticky-favorited even if you later
    pass on it repeatedly.
  - 🗑 / drag down — remove entirely, regardless of current priority.
  - Priority starts at 5 per recipe; hitting 0 via repeated passes removes it too, same as the
    trash button.
- **Favorites screen**: tap the ★. Two tabs:
  - **Yours** — everything you've favorited (and not since removed).
  - **Shared** — the live intersection of every household member's favorites (this is what
    "match" means now — no calendar, just this list).
- **Reload the page** — deck/favorites state should persist (synced through Supabase, not just
  local), and you should land straight back in the app (no re-sign-in) since Supabase persists
  the session.
- **Sign out**: nav drawer → Sign out. You should land back on the Google sign-in screen.

## 4. Test two household members' swipes actually meet in the middle

This is the part that most needs a real check, since it's the whole point of "Shared":

1. Sign in with your Google account, create a household, and favorite (♥) some recipe.
2. Sign in with a second Google account on another device/browser profile (or an incognito
   window) and join the same household using its invite code (nav drawer of the first account).
3. Favorite the *same* recipe as the second account (you'll need to find it — "New" deck order
   is deterministic, so if the second account hasn't swiped anything yet, its first card matches
   whatever the first account's first card originally was).
4. Open Favorites → Shared on either account — that recipe should now be listed.
5. Confirm a *third*, unrelated Google account (not invited to this household) sees none of
   this — a fresh sign-in with no invite code should only be able to create its own empty
   household, never read or write this one's data.

## 5. Test on your phone

1. Connect your phone to the same wifi as this machine.
2. Open the `Network` URL from step 2 in Chrome (Android).
3. Confirm touch dragging feels right for all three directions (left/right/down) — this is the
   part a desktop mouse can't fully validate (gesture threshold, card rotation, drag friction).
4. Tap the browser menu → **Add to Home Screen** / **Install app**.
5. Launch it from the home screen icon — it should open standalone (no browser chrome/URL bar).
6. Turn on airplane mode after it's loaded once, relaunch from the home screen icon, and
   confirm the deck still loads from cache (validates the offline PWA caching). A swipe made
   offline should still register locally and sync once you're back online.
7. Have another household member install it on their own phone and repeat the multi-member check
   from step 4 for real, instead of simulating their side.

## 6. Sanity-check the data prep, if you touch the scripts

```
cd scripts
node -e "const d=require('./image-manifest.json'); console.log(Object.keys(d).length, 'images')"
```
Should print `3921`. And spot-check the sub-recipe flags:
```
cd ..
node -e "const d=require('./app/public/data/recipes.json'); console.log(d.filter(r=>r.isComponent).length, 'components,', d.filter(r=>!r.hasSteps).length, 'missing steps')"
```
Should print `29 components, 18 missing steps` — if either number balloons or goes to zero
after a heuristic tweak, something's off.

## 7. If you want to poke at the data directly

The Supabase dashboard (Table Editor) lets you look at `recipe_priority` and `swipe_events`
directly — handy for confirming a swipe actually landed, or resetting your own test data. `user_id`
is now a real `profiles.id` uuid (find yours via the `profiles` table, matched by `email`), and
every row also carries `household_id` — `delete from recipe_priority where user_id = '<your
uuid>'` clears just your priorities, not the rest of your household's.
