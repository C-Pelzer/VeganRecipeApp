# Testing the swipe deck

## 1. Rebuild the data bundle (only needed after touching the pipeline/scripts)

```
cd scripts
node extract-images.mjs   # -> scripts/image-manifest.json + app/public/images/recipes/*
node build-bundle.mjs     # -> app/public/data/recipes.json
```

Already run for the current 5 processed books — skip this unless you re-run `extract.py`/`apply_metric.py` upstream.

## 2. Start the dev server

```
cd app
npm run dev
```

Vite prints two URLs: a `localhost` one and a `Network` one. The Network one is what your phone needs — it looks like `http://192.168.0.4:5173` (this machine's current LAN IP; Vite will print whatever's current).

## 3. Test on desktop first (fastest feedback loop)

Open the `localhost` URL in a browser.

- **Profile picker** shows on first load — tap "Cameron" or "Mallorie".
- **Deck** loads with a counter (`0 / 854`) — 854 because 11 of 865 recipes are flagged as sub-recipes (sauces, a crust, a spice blend) and excluded by default.
- **Swipe**: drag a card left/right past the halfway point, or use the ✕/♥ buttons. Card should fly off, counter should increment, next card takes its place.
- **Reload the page** — you should land back on the deck (not the profile picker) with your progress intact. That's `localStorage`, so it's per-browser/per-device, not synced yet.
- **Switch user**: open dev tools → Application → Local Storage → delete `recipe-app:currentUser` → reload → picker reappears. Pick "Mallorie" and confirm her swipe count starts at 0 independently of Cameron's.
- **No-image cards**: keep swiping (or jump ahead — see below) until you hit a *Ultimate Vegan Cookbook* recipe; confirm the 🌱 placeholder shows instead of a broken image.

To jump straight to a specific point instead of swiping hundreds of cards, seed `localStorage` from the console before reloading:
```js
fetch('/data/recipes.json').then(r => r.json()).then(recipes => {
  const skip = recipes.filter(r => r.source_book !== 'The Ultimate Vegan Cookbook').map(r => r.id)
  localStorage.setItem('recipe-app:currentUser', 'Cameron')
  localStorage.setItem('recipe-app:swipes', JSON.stringify(
    skip.map(recipeId => ({ userId: 'Cameron', recipeId, direction: 'right', swipedAt: new Date().toISOString() }))
  ))
})
```
then reload.

## 4. Test on your phone

1. Connect your phone to the same wifi as this machine.
2. Open the `Network` URL from step 2 in Chrome (Android).
3. Confirm touch dragging feels right — this is the part a desktop mouse can't fully validate (gesture threshold, card rotation, drag friction).
4. Tap the browser menu → **Add to Home Screen** / **Install app**.
5. Launch it from the home screen icon — it should open standalone (no browser chrome/URL bar).
6. Turn on airplane mode after it's loaded once, relaunch from the home screen icon, and confirm the deck still loads from cache (validates the offline PWA caching).
7. Repeat picking "Mallorie" on her phone once you're ready to test both devices side by side — remember swipes don't sync between devices yet, so her progress and Cameron's stay separate until the Supabase pass lands.

## 5. Sanity-check the data prep, if you touch the scripts

```
cd scripts
node -e "const d=require('./image-manifest.json'); console.log(Object.keys(d).length, 'images')"
```
Should print `308`. And spot-check the sub-recipe flags:
```
cd ..
node -e "const d=require('./app/public/data/recipes.json'); d.filter(r=>r.isComponent).forEach(r=>console.log(r.title))"
```
Should print the same ~11 sauces/crusts/dressings called out in the last summary — if that list balloons or goes empty after a heuristic tweak, something's off.
