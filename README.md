# Lumen

Architectural lighting and modular furniture on a shared 24V DC bus. Lumen is the
platform for browsing the parts, planning a room in 3D, composing a wall in 2D and
ordering the exact bill of materials.

Current release: **v0.1.0**. Repository genesis, design tokens, routing shell, security
foundation and E2E harness.

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
  components/           LayoutShell, Navbar, Footer, BagDrawer, ModeSwitch,
                        PageHeader, WorkspaceFrame, icons
  pages/                Home, Catalog, RoomPlanner, WallStudio, NotFound
  hooks/                useAmbientLight, useDisplayMode, useDocumentTitle
  lib/                  route manifest, display mode persistence
  security/sanitize.js  safeJsonParse, safeStorage, input validators
  styles/               tokens, base, shell, home, pages
server/                 reserved for the API and cloud persistence phase
tests/                  Playwright specs, named by architectural domain
```

## Routes

| Path         | View          | Role                                                  |
| ------------ | ------------- | ----------------------------------------------------- |
| `/`          | Overview      | Hero with pointer-driven tungsten light, system specs |
| `/catalog`   | Catalog       | Filter rail and product grid shell (filtering: v0.2)  |
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
