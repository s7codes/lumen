# Lumen

[![Playwright E2E](https://github.com/s7codes/lumen/actions/workflows/ci.yml/badge.svg)](https://github.com/s7codes/lumen/actions/workflows/ci.yml)
![Release](https://img.shields.io/badge/release-v0.3.0-e8923a)
![React](https://img.shields.io/badge/React-19-2a2825)
![Vite](https://img.shields.io/badge/Vite-8-2a2825)
![CSP](https://img.shields.io/badge/CSP-strict-44484b)

Architectural lighting and modular furniture on a shared 24V DC bus. Lumen is the
platform for browsing the parts, planning a room in 3D, composing a wall in 2D and
ordering the exact bill of materials.

Current release: **v0.3.0**. Interactive 2D Wall Studio on `/studio-2d` with drag,
collision and slope checks, undo history and JSON layouts; one-click wall to bag sync
with live 24V telemetry; frame-rate independent pendant physics; GitHub Actions CI.

Previous: **v0.2.0**. Canonical product dataset, filterable catalog with procedural scale
elevations, persistent bag with a 24V load and driver calculator, and a surface and
dimming lab on the overview. **v0.1.0**. Repository genesis, design tokens, routing
shell, security foundation and E2E harness.

## Stack

- Vite 8, React 19, React Router 7 (data router)
- Playwright for end-to-end verification against the production build
- Inter Tight and IBM Plex Mono, self-hosted through Fontsource (no third-party requests);
  the build preloads the three Latin faces so text never reflows after first paint
- Planned: Three.js / React Three Fiber room engine, embedded Spatial Studio, API in `server/`

## Layout

```
index.html              CSP meta policy, favicon, entry point
vite.config.js          build config, dev-only CSP relaxation for HMR
.github/workflows/      ci.yml: install, Chromium, build, Playwright on main and develop
src/
  main.jsx              boot: fonts, tokens, persisted display mode, router
  router.jsx            route table, per-entry history key seeding
  components/           LayoutShell, Navbar, Footer, BagProvider, BagDrawer,
                        ModeSwitch, ProductCard, ProductElevation, SurfaceLab,
                        PageHeader, WorkspaceFrame, icons
    studio/             WallStage, StudioPalette, StudioInspector, StudioToolbar,
                        StudioSummary, shared field and switch controls
  data/                 products.js (parts, finishes, categories), wall-presets.js
  pages/                Home, Catalog, RoomPlanner, WallStudio, NotFound
  hooks/                useAmbientLight, useBag, useDisplayMode, useDocumentTitle,
                        useWallStudio
  lib/                  bag store and PSU sizing, wall studio geometry and history,
                        closed-form spring, display mode store, photometry,
                        formatting, route manifest
  security/sanitize.js  safeJsonParse, safeStorage, input validators
  styles/               tokens, base, shell, home, pages, product, studio
server/                 reserved for the API and cloud persistence phase
tests/                  Playwright specs, named by architectural domain
  support/              shared runtime, CSP and overflow guards
```

## Routes

| Path         | View          | Role                                                      |
| ------------ | ------------- | --------------------------------------------------------- |
| `/`          | Overview      | Pendant hero, surface and dimming lab, core modules       |
| `/catalog`   | Catalog       | Category, search and sort over 8 parts, finish swatch     |
| `/room-3d`   | Room Planner  | Viewport frame and inspector for the R3F engine           |
| `/studio-2d` | Wall Studio   | To-scale elevation planner, telemetry, sync to bag        |

## Design system

All values live in `src/styles/tokens.css`. Warm basalt surfaces, alabaster type,
tungsten amber (`#e8923a`) as the single accent, anodized aluminum neutrals. Hairline
borders, 2-4px radii, tabular-nums index labels (`01 / OVERVIEW`). A 12-column
structural grid is exposed behind the shell. Technical mode tints it amber and reveals
measurement overlays; the choice persists through validated storage.

The hero light is a damped spring (`k = 90`, `c = 12`, slightly under-damped). Each rAF
frame advances it by the elapsed time, `dt = min((now - lastTime) / 1000, 0.05)`, using
the closed-form solution of the spring equation rather than an Euler step. The result is
exact for any `dt`, so a 60Hz panel, a 120Hz ProMotion display and a 240Hz monitor trace
the same curve with the same velocity and damping; the 50 ms cap keeps a backgrounded tab
from jumping on return. It writes `--light-x`, `--light-y` and `--light-energy` as CSS
custom properties, so React never re-renders on pointer movement.

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

## Wall Studio

- Drawing scale is `1 cm = 2.5 px`. The viewport reduces it only as far as needed to fit
  the wall on screen and reports the view percentage. Walls run 180-400 cm wide and
  180-320 cm high (default 300 x 250 cm), with an optional 90 x 90 cm attic slope cut
  from the top-right corner, a 5 cm grid snap and an Ambient Dark or Daylight surface.
- The palette mounts any of the 8 parts at its catalog `dimsCm`, default finish, in the
  first clear position near its natural height (floor, eye level, ceiling). Three
  presets load collision-free compositions: Nordic Reading Wall, Acoustic Media Spine
  and Attic Study Alcove.
- Pointer drag is throttled to `requestAnimationFrame`, quantized to 1 cm (5 cm with
  snap) and clamped to the wall. Conflicts are flagged live: AABB overlap between
  modules, cuts into the slope (`x + y > W + H - 90` at the module's top-right corner)
  and modules larger than a resized wall. Arrow keys nudge, Shift multiplies by 10.
- Technical mode adds SKU tags, mounting anchors, offsets from the left wall edge and
  the floor, and module dimensions on the elevation.
- The inspector switches finish, toggles the 24V LED channel, edits `Left X` and
  `Bottom from Floor` in cm, duplicates, locks and removes. Every edit is one step in a
  30-step undo history (`Ctrl+Z`, `Ctrl+Y` or `Ctrl+Shift+Z`, and toolbar buttons).
- The layout persists under `lumen_wall_studio_v1` through `safeStorage`. Reads and JSON
  imports pass `safeJsonParse` and a sanitizer that requires the `lumen.wall` envelope,
  drops unknown parts and finishes, rounds and clamps coordinates, reissues bad or
  duplicate ids and caps the wall at 48 modules. Export writes the same envelope.
- The summary reports modules, connected 24V load, live flux, price and driver. **Sync
  Wall to Bag** groups modules by part and finish, merges them into the shared bag and
  opens the drawer, where the PSU is sized on the full connected load.

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

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main` and `develop`:
`npm ci`, Playwright Chromium with system dependencies, `npm run build`, then
`npx playwright test` against the built bundle. The HTML report is kept as an artifact.

## Workflow

- `main` holds tagged releases, `develop` integrates, each milestone lands on `feat/*`.
- Lower-case Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `security:`, `docs:`.
- Test files are named by domain, for example `app-shell.spec.js`.
