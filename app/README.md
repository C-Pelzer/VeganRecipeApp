# App

React PWA (Vite + TypeScript + Tailwind). See the [repo root README](../README.md) for what
this project is and how the pieces fit together, and [TESTING.md](./TESTING.md) for a full
test walkthrough.

## Dev

```
npm install
npm run dev
```

Needs `.env.local` with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — see `.env.example`.

```
npm run build   # tsc -b && vite build
npm run lint    # oxlint
```
