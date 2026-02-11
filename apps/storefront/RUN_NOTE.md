# 🎮 Bit Indie v2 Storefront — Lane B Run Note

## What was scaffolded
- Vite + React + TypeScript app scaffold in:
  - `projects/bit-indie-v2/apps/storefront`
- MVP production-ready shell for `/` with:
  - Neon/dark arcade design tokens from `bi-concept-1-dark-arcade-neon.svg`
  - Header/nav shell
  - Hero section (CTA + login placeholder)
  - Featured card placeholders
  - Wiring-ready API layer (`src/api/client.ts`, `src/api/catalog.ts`)

## File map (key files)
- `src/theme/tokens.css` — theme tokens (colors, spacing, radii, typography)
- `src/layout/AppShell.tsx` + `src/layout/AppShell.css` — page shell and top bar
- `src/components/Hero.tsx` + `src/components/Hero.css` — hero block and CTA controls
- `src/components/FeaturedSection.tsx` + `src/components/FeaturedSection.css` — featured game card grid
- `src/pages/HomePage.tsx` — root `/` composition and data loading
- `src/api/client.ts` — typed fetch client with env-driven base URL/token
- `src/api/catalog.ts` — featured games endpoint adapter + fallback seed data
- `src/types/catalog.ts` — catalog domain types
- `.env.example` — API env vars
- `src/App.tsx` + `src/main.tsx` + `src/index.css` — app bootstrap and global style wiring

## How to run locally
```bash
cd /home/openclaw/.openclaw/workspace/projects/bit-indie-v2/apps/storefront
cp .env.example .env # optional
npm install
npm run dev
```

Build/preview:
```bash
npm run build
npm run preview
```

## Notes / caveats from this environment
- `npm install` in this runtime failed due `esbuild` binary crashing (`SIGSEGV`) under Node `v25.2.1`.
- Scaffold/code changes are complete, but install/build validation should be run in a local environment with Node LTS (recommended: Node 22 or 20).

## Screenshots
- No app runtime screenshots were generated in this environment due the install/runtime blocker above.
