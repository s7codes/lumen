# Lumen

[![Playwright E2E](https://github.com/s7codes/lumen/actions/workflows/ci.yml/badge.svg)](https://github.com/s7codes/lumen/actions/workflows/ci.yml)
![Release](https://img.shields.io/badge/release-v0.6.0-e8923a)
![React](https://img.shields.io/badge/React-19-2a2825)
![Vite](https://img.shields.io/badge/Vite-8-2a2825)
![CSP](https://img.shields.io/badge/CSP-strict-44484b)

Architectural lighting and modular furniture on a shared 24V DC bus. Lumen is the
platform for browsing the parts, planning a room in 3D, composing a wall in 2D and
ordering the exact bill of materials.

Current release: **v0.6.0**. Motion and progressive disclosure. Overview and catalog
sections slide up into place as they enter the viewport, grids cascade card by card;
primary actions are tactile keys that lift off a hard plinth and pull toward the
pointer; the planners open in a quiet default with glass side panels, folded dimension
inputs, coordinates only for a selected module, a floating camera HUD with a camera
settings popover (yaw, pitch, zoom, wireframe), and the rest of the UI stepping back
while a module is dragged or the room is orbited.

Previous: **v0.5.0**. Product specification sheets on `/catalog/:id` with three
to-scale orthographic views, a polar intensity diagram (or the 24V bus voltage drop
curve for hardware) and direct launchers into both planners; a project checkout on
`/checkout` with automatic driver provisioning, USD / EUR / HUF, trade codes, a
printable quote, JSON export and requisition. **v0.4.0**. Interactive 3D Room Planner on `/room-3d`, 2D wall bridge, brand
mark and flat Arch / Tech mode switch. **v0.3.0**. Interactive 2D Wall Studio on `/studio-2d`, one-click wall to bag
sync, frame-rate independent pendant physics, GitHub Actions CI. **v0.2.0**. Canonical product dataset, filterable catalog with procedural scale
elevations, persistent bag with a 24V load and driver calculator, and a surface and
dimming lab on the overview. **v0.1.0**. Repository genesis, design tokens, routing
shell, security foundation and E2E harness.

## Stack

- Vite 8, React 19, React Router 7 (data router)
- Playwright for end-to-end verification against the production build
- Inter Tight and IBM Plex Mono, self-hosted through Fontsource (no third-party requests);
  the build preloads the three Latin faces so text never reflows after first paint
- Room engine: an in-house perspective compiler that renders to SVG. No WebGL context, so
  it runs identically in headless Chromium and on low-end GPUs, with no extra dependency
- Planned: embedded Spatial Studio, API in `server/`

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
                        PageHeader, WorkspaceFrame, BlueprintViews,
                        PhotometricCurve, icons
    studio/             WallStage, StudioPalette, StudioInspector, StudioToolbar,
                        StudioSummary, shared field, switch and finish controls
    room3d/             RoomViewport, RoomControls, RoomInspector, RoomToolbar,
                        RoomSummary, CameraSettings
  data/                 products.js (parts, finishes, categories), wall-presets.js
  pages/                Home, Catalog, ProductDetail, Checkout, RoomPlanner,
                        WallStudio, NotFound
  hooks/                useAmbientLight, useBag, useDisplayMode, useDocumentTitle,
                        useLaunchedModule, useMagneticField, useRoom3d,
                        useScrollReveal, useWallStudio
  lib/                  bag store and PSU sizing, wall studio geometry and history,
                        room model and 2D bridge (room-3d), scene compiler
                        (room-scene), closed-form spring, display mode store,
                        photometry and intensity model, 24V bus electrical model,
                        quote engine, formatting, route manifest
  security/sanitize.js  safeJsonParse, safeStorage, input validators
  styles/               tokens, base, animations, shell, home, pages, product,
                        product-detail, checkout, studio, room3d
server/                 reserved for the API and cloud persistence phase
tests/                  Playwright specs, named by architectural domain
  support/              shared runtime, CSP and overflow guards
```

## Routes

| Path         | View          | Role                                                      |
| ------------ | ------------- | --------------------------------------------------------- |
| `/`          | Overview      | Pendant hero, surface and dimming lab, core modules       |
| `/catalog`   | Catalog       | Category, search and sort over 8 parts, finish swatch     |
| `/catalog/:id` | Spec sheet  | Orthographic set, photometry or bus curve, launchers      |
| `/checkout`  | Project Quote | BOM, driver, currency, trade code, print, export, submit  |
| `/room-3d`   | Room Planner  | 3D room, furniture clearances, 2D wall bridge, bag sync   |
| `/studio-2d` | Wall Studio   | To-scale elevation planner, telemetry, sync to bag        |

## Design system

All values live in `src/styles/tokens.css`. Warm basalt surfaces, alabaster type,
tungsten amber (`#e8923a`) as the single accent, anodized aluminum neutrals. Hairline
borders, 2-4px radii, tabular-nums index labels (`01 / OVERVIEW`). A 12-column
structural grid is exposed behind the shell. Technical mode tints it amber and reveals
measurement overlays; the choice persists through validated storage.

The mark is a 24 x 24 monogram: structural spine, base return and a cantilevered shelf
slab in alabaster, with a 2 x 6.5 tungsten aperture held between slab and base. It pairs
with `LUMEN` tracked at 0.14em; `public/favicon.svg` carries the same geometry on basalt.
The display mode switch is two typographic segments in a 1px frame, and the engaged one
inverts to solid alabaster. Buttons, switches and badges never glow: light belongs only to
the simulated fixtures.

The hero light is a damped spring (`k = 90`, `c = 12`, slightly under-damped). Each rAF
frame advances it by the elapsed time, `dt = min((now - lastTime) / 1000, 0.05)`, using
the closed-form solution of the spring equation rather than an Euler step. The result is
exact for any `dt`, so a 60Hz panel, a 120Hz ProMotion display and a 240Hz monitor trace
the same curve with the same velocity and damping; the 50 ms cap keeps a backgrounded tab
from jumping on return. It writes `--light-x`, `--light-y` and `--light-energy` as CSS
custom properties, so React never re-renders on pointer movement.

## Motion

- Scroll reveal: `useScrollReveal` returns a ref for any `.reveal-up` element. One shared
  `IntersectionObserver` (bottom margin -10%) fires it once: 40px of travel and a fade over
  800 ms on `cubic-bezier(0.2, 0.8, 0.2, 1)`. Elements that enter in the same frame are
  ordered top to bottom, left to right, and each `.reveal-stagger` parent hands its
  children one 100 ms step apiece, so a row of three cards lands at 0, 100 and 200 ms.
  Content already scrolled past on a restored position appears without motion. The
  hidden state is gated on `html[data-reveal='on']`, set only when the observer exists.
- Tactile keys: every `.button` lifts 2px on hover off a 4px plinth drawn as a zero-blur
  offset `box-shadow`. `useMagneticField` is one delegated pointer listener that pulls
  the hovered key toward a fine pointer by at most 4 x 3 px; the plinth stays where the
  key rests, so it trails the cap. Arrows slide 4px, the add glyph turns a quarter.
  Nothing glows: the plinth has no blur, and the glow guard in the E2E suite holds.
- `src/styles/animations.css` holds the reveal states and the shared keyframes (rise,
  settle, unfold, transient status lines). Under `prefers-reduced-motion: reduce` every
  section renders at rest, keys do not drift and status lines stay put.

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
- Progressive disclosure: wall width and height fold into a **Dimensions** summary row
  (`300 x 250 cm`) that unfolds on demand and is inert while closed. With nothing
  selected the inspector is a plain module list, coordinates showing only under the
  pointer (always in technical mode); selecting a module settles the detail in section
  by section and unfolds the position block. Status lines fade after six seconds.
- Side panels are glass (`backdrop-filter` blur over 46% basalt) and stick under the
  navbar from 960px up, scrolling on their own. Readouts under the stage stay hidden
  until the stage is hovered, focused or has a selection. While a module is dragged,
  the panels, toolbar, summary and the other modules step back to 28-45% opacity.
- The layout persists under `lumen_wall_studio_v1` through `safeStorage`. Reads and JSON
  imports pass `safeJsonParse` and a sanitizer that requires the `lumen.wall` envelope,
  drops unknown parts and finishes, rounds and clamps coordinates, reissues bad or
  duplicate ids and caps the wall at 48 modules. Export writes the same envelope.
- The summary reports modules, connected 24V load, live flux, price and driver. **Sync
  Wall to Bag** groups modules by part and finish, merges them into the shared bag and
  opens the drawer, where the PSU is sized on the full connected load.

## Room Planner

- Rooms run 240-500 cm wide, 200-450 cm deep and 220-320 cm to the ceiling (default
  320 x 280 x 250 cm). The main wall sits at Z 0 and shares Wall Studio coordinates:
  `Left X` and `Bottom Y` in cm, modules extruded to their catalog depth.
- `src/lib/room-scene.js` projects the room through an orbit pinhole camera (yaw -65 to
  65 deg, pitch 8 to 50 deg, zoom 0.6-1.8x). Faces are back-face culled, a side wall that
  turns away from the camera is cut like a section model, and solids are painter-sorted
  by separating planes, which is exact for disjoint boxes. Same input, same polygons.
- Presets (Perspective, Front Elevation, Corner Iso, Reset Camera) glide in on the
  closed-form spring, critically damped. Pointer drag orbits, wheel and pinch zoom, and
  the arrow keys, `+`, `-` and `Home` drive the camera from the keyboard.
- The camera controls float over the scene as glass pills: presets and reset on the
  left, zoom and a **Camera settings** fader button on the right. The popover holds the
  live readout, Yaw, Pitch and Zoom faders (sanitized through `sanitizeCamera`) and a
  **Wireframe** switch that turns faces to smoked glass and draws every box and room
  edge, hidden edges dashed. It closes on Escape, a second press or any press outside.
  Wireframe is view state for the session; the camera persists. Below 768px the HUD
  docks above the scene. While the room is orbited the surrounding panels step back.
- Room dimensions fold into a **Dimensions** summary row like the Wall Studio's.
- Floor references: Low Platform Bed 160cm, Architect Desk 140cm, Modular Sofa 200cm.
  Modules are tested against them as true 3D boxes, so an art frame can hang behind a
  sofa back while a sideboard cannot.
- Night Ambient (2700K) or Daylight Studio. Each lit module casts washes, halos and floor
  pools in its own CCT; switching its 24V channel off removes the light.
- Technical mode adds wireframe edges (hidden edges dashed), X / Y / Z axes in cm, SKU
  tags and clearance callouts: walkway, headroom over the furniture, floor and ceiling.
- **Load from 2D Wall Studio** reads `lumen_wall_studio_v1`, or the Nordic Reading Wall
  when it is empty. **Push to 2D Wall Studio** writes the main wall back, capped at the
  400 cm studio width. **Sync Room to Bag** merges the modules and opens the drawer.
- State persists under `lumen_room_3d_v1` and is rebuilt on every read with the wall
  layout's per-module rules plus a clamped envelope, furniture, lighting and camera.

## Spec sheets

- Every catalog and overview card title links to `/catalog/:id?finish=<id>`. Unknown or
  malformed ids render a not-found state; a finish the part does not ship in falls back
  to its default.
- Three procedural SVG views at the largest standard scale that fits (1:1 to 1:50):
  Front Elevation, Side Section (Z depth, cut hatch, 12 x 8 mm 24V bus channel, wall or
  plaster datum) and Mounting & Anchor Detail (rear view, chained anchor centres in cm,
  fixing schedule). Anchors come from the same function the Wall Studio draws with.
- Photometry: each lobe is `I(t) = I0 cos^m(t)` with `I0 = flux (m + 1) / 2pi`, so the
  polar curve integrates back to the catalog lumens. The spot uses `m` solved from its
  36 deg beam. A probe slider reads intensity at any angle; on-axis lux at 0.5, 1.0 and
  2.0 m follows the inverse-square law.
- The Track Bus 200 shows its 24V feed instead: 6.25 A at 150 W, 2 x 2.5 mm2 copper,
  end-fed worst-case drop for 60 / 100 / 150 W against run length, and the run that
  stays inside a 3% drop.
- **Mount in 2D Wall Studio** and **Place in 3D Room** write the part, in the chosen
  finish, to the first clear spot in `lumen_wall_studio_v1` or `lumen_room_3d_v1`, then
  open the planner with that module selected. **Add to Bag** takes a quantity.

## Checkout and quote

- **Configure Quote & Checkout** in the bag drawer opens `/checkout`. The BOM lists every
  bag line plus the 24V driver sized on the connected load (60W, 150W or a multi-bus
  array of 150W units); the driver line can be excluded, which flags the quote.
- USD, EUR (0.92) and HUF (360), persisted under `lumen_currency_v1`. Rates are exact
  ratios, so every amount is an integer of cents or whole forints. Discount and 27% VAT
  are each rounded once, half up, and gross is their sum, so
  `net - discount + vat === gross` holds exactly in every currency.
- Trade codes `LUMEN10`, `TRADE15`, `STUDIO20`, case and whitespace insensitive.
- Project reference, client and installation notes are sanitized (`sanitizeText`,
  `sanitizeMultilineText`) and rendered as text only.
- **Print Official Quote** prints only the quote sheet on A4 in black on white.
  **Download Spec JSON** exports the `lumen.quote` envelope with the BOM in minor units.
  **Submit Project Requisition** validates the form and issues an `LMN-R-` reference.

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
npm run dev                       # http://127.0.0.1:5173 (also http://localhost:5173)
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
- Releases advance `develop` and `main` by pointer (`git branch -f`) from the finished
  feature branch, never by switching back first, so no working-tree directories are
  deleted on synced (OneDrive) folders.
- Lower-case Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `security:`, `docs:`.
- Test files are named by domain, for example `app-shell.spec.js`.
