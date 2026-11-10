# Lumen

Architectural lighting and modular furniture on a shared 24V DC bus. Lumen is the
platform for browsing the parts, planning a room in 3D, composing a wall in 2D and
ordering the exact bill of materials.

Current release: **v0.1.0**. Repository genesis, design tokens, routing shell, security
foundation and E2E harness.

Next: **v0.2.0**. Canonical product dataset, filterable catalog with procedural scale
elevations, persistent bag with a 24V load and driver calculator, and a surface and
dimming lab on the overview.

## Stack

- Vite 8, React 19, React Router 7 (data router)
- Playwright for end-to-end verification against the production build
- Inter Tight and IBM Plex Mono, self-hosted through Fontsource (no third-party requests)
- Planned: Three.js / React Three Fiber room engine, embedded Spatial Studio, API in `server/`

## Layout

```
index.html              CSP meta policy, favicon, entry point
vite.config.js          build config, dev-only CSP relaxation for HMR
src/
  main.jsx              boot: fonts, tokens, persisted display mode, router
  router.jsx            route table, per-entry history key seeding
  components/           LayoutShell, Navbar, Footer, BagProvider, BagDrawer,
                        ModeSwitch, ProductCard, ProductElevation, SurfaceLab,
                        PageHeader, WorkspaceFrame, icons
  data/products.js      canonical product, finish and category dataset
  pages/                Home, Catalog, RoomPlanner, WallStudio, NotFound
  hooks/                useAmbientLight, useBag, useDisplayMode, useDocumentTitle
  lib/                  bag store and PSU sizing, display mode store,
                        photometry, formatting, route manifest
  security/sanitize.js  safeJsonParse, safeStorage, input validators
  styles/               tokens, base, shell, home, pages, product
server/                 reserved for the API and cloud persistence phase
tests/                  Playwright specs, named by architectural domain
  support/              shared runtime, CSP and overflow guards
```

## Routes

| Path         | View          | Role                                                  |
| ------------ | ------------- | ----------------------------------------------------- |
| `/`          | Overview      | Pendant hero, surface and dimming lab, core modules   |
| `/catalog`   | Catalog       | Category, search and sort over 8 parts, finish swatch |
| `/room-3d`   | Room Planner  | Viewport frame and inspector for the R3F engine       |
| `/studio-2d` | Wall Studio   | Ruled elevation canvas, Spatial Studio mount point    |

## Design system

All values live in `src/styles/tokens.css`. Warm basalt surfaces, alabaster type,
tungsten amber (`#e8923a`) as the single accent, anodized aluminum neutrals. Hairline
borders, 2-4px radii, tabular-nums index labels (`01 / OVERVIEW`). A 12-column
structural grid is exposed behind the shell. Technical mode tints it amber and reveals
measurement overlays; the choice persists through validated storage.

The hero light is a damped spring (`k = 90`, `c = 12`, slightly under-damped) integrated
per frame. It writes `--light-x`, `--light-y` and `--light-energy` as CSS custom
properties, so React never re-renders on pointer movement.

## Catalog and bag

- `src/data/products.js` is the single source for parts: SKU, price, dimensions, 24V load,
  lumen output, CCT, CRI, mounting points, lead time and the finishes each part ships in.
  Finishes carry their hex ramp, LRV and gloss so the catalog drawings and the lab read
  the same values.
- Each catalog card draws a front elevation at the largest standard scale that fits
  (1:2 to 1:50). Architectural mode shows finish and editorial copy; technical mode adds
  dimension lines, anchor points and the telemetry grid (SKU, load, lm, lm/W, CRI).
- The bag is stored under `lumen_bag_v1` through `safeStorage`. Every read is rebuilt line
  by line: unknown products, finishes a part does not ship in and quantities outside
  1-99 are dropped, duplicates merge, and the cleaned value is written back. Other tabs
  follow through the `storage` event and pass through the same validation.
- Driver sizing: up to 60W on one 60W driver, up to 150W on one 150W driver, above that
  a multi-bus array of 150W drivers.

## Security

- Production CSP: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'`
  and friends. No inline scripts, no eval. The dev server widens `script-src` and
  `connect-src` only for React Fast Refresh and the HMR socket. Builds ship the policy
  untouched, and the E2E suite runs against the build to prove it.
- `safeJsonParse` strips `__proto__`, `constructor` and `prototype` at every depth, caps
  input length and nesting, and never throws.
- `safeStorage` namespaces keys under `lumen:`, validates every read, and degrades to a
  no-op when storage is blocked.
- `isSafeInternalPath`, `isSafeId`, `sanitizeText` and `clampNumber` cover URL, ID,
  free-text and numeric input.

## Development

Requires Node `^20.19.0` or `>=22.12.0`.

```
npm install
npx playwright install chromium   # first run only
npm run dev                       # http://localhost:5173
npm run build
npm run preview                   # http://localhost:4173
npx playwright test               # builds, serves preview, runs the E2E suite
```

## Workflow

- `main` holds tagged releases, `develop` integrates, each milestone lands on `feat/*`.
- Lower-case Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `security:`, `docs:`.
- Test files are named by domain, for example `app-shell.spec.js`.
