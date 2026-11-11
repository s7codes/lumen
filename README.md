# Lumen

[![Playwright E2E](https://github.com/s7codes/lumen/actions/workflows/ci.yml/badge.svg)](https://github.com/s7codes/lumen/actions/workflows/ci.yml)
![Release](https://img.shields.io/badge/release-v3.5.0-e8923a)
![License: MIT](https://img.shields.io/badge/license-MIT-2a2825)

Architectural lighting and modular furniture on a shared 24V DC bus. Lumen is the
platform for browsing the parts, planning a room in 3D, composing a wall in 2D and
ordering the exact bill of materials.

Current release: **v3.5.0**. Every powered module carries a DALI-2 arc level, `dimPct`
from 10 to 100%. Selecting a lit module in either planner, or several in the 2D
Multi-Selection inspector, reveals a **Dimming (10-100%)** slider that commits one undo
step on release. The level scales delivered flux and active 24V draw everywhere it is
read: the summary bars, the lumen-method physics, the point-by-point wall and floor lux
fields, the bus current and cumulative drop, the 3D emitters and lights, and the
blueprint sheet. Driver sizing stays on the rated connected load. A **DALI-2** scene strip
in both planners recalls four scenes in one undo step: **Full Output (100%)**,
**Morning Focus** (task 100%, accent 65%, daylight), **Evening Lounge** (task 45%,
accent 85%) and **Night Gallery** (task 20%, accent 40%), with task parts (shelf, lightbar,
pendant, spot, cube) and accent parts (frame, sconce, column, sideboard) defined in
`src/lib/lighting-scenes.js`. The 3D Room Planner gains undo and redo (`Ctrl+Z`,
`Ctrl+Y`); camera moves stay out of the history. The level is held only below 100, so
stored layouts, cloud projects and `?scene=` links without it read as 100% and encode
byte for byte as before; a dimmed module appends a 7th element to its link tuple.

v3.4.0 made the 2D Wall Studio issue installation drawings.
**Blueprint** in the toolbar opens a 1:20 ISO A3 elevation compiled by
`src/lib/blueprint-sheet.js`: the wall envelope with its attic slope cut, overall and
running dimension chains, every module as `M01`, `M02`... with SKU, finish and wattage,
the routed 24V bus from `PSU 24V FEED`, and an absolute **Drilling & Anchor Schedule**
(`A01`, `A02`... in cm from the bottom-left datum at FFL, with fixing hardware) under an
ISO 7200 title block issued by Lumen Spatial Studio Kft., 1052 Budapest. The sheet
downloads as a self-contained SVG or as an AutoCAD R12 ASCII DXF (`src/lib/dxf-export.js`)
on six `LUMEN_*` layers, drawn in true centimetres.

v3.3.0 turned the 2D Wall Studio into a CAD selection surface.
`Shift + Click` toggles modules into a selection, a rubber-band marquee on bare wall picks
every module it touches, `Ctrl+A` / `Cmd+A` takes all unlocked modules and `Escape`
clears. A selection moves as a rigid group by pointer or arrow keys, clamped so no member
leaves the wall, and deletes as one undo step. A **Multi-Selection** inspector aligns
edges and centrelines to the selection's bounding box, distributes three or more modules
with equal gaps, and switches finish and the 24V channel in one edit. While dragging,
**smart guides** draw hairlines wherever an edge or centreline falls within 2 cm of the
wall centreline, the 145 cm eye-level datum or a sibling module, labelled with the
offset. CI drops the `--with-deps` apt step that failed on unreachable Ubuntu mirrors and
runs once per release push instead of twice.

v3.2.0 read acoustics in six ISO octave bands, 125 Hz to 4 kHz:
Sabine per band with frequency-dependent coefficients and an air term above 500 Hz,
reported as `octaveRt60`, plus a reverberation-only Speech Transmission Index graded
Poor, Fair, Good or Excellent. Both planners show `STI 0.54 (Fair)` under the 500 Hz
RT60 and, in Technical mode, a six-bar RT60 spectrum. The catalog grows to 12 parts:
**Linear Suspension Pendant 150**, **Acoustic Wall Baffle 120** (50 mm PET felt, NRC 0.85),
**Vertical Architectural Sconce 80** and the **Recessed 24V DALI-2 Bus Hub**, which feeds
and passes through the bus like the track. Every drawing, the 3D room, the bus router and
the photometric field handle all twelve. The code is MIT licensed.

v3.1.0 resolved illuminance point by point.
`src/lib/illuminance-field.js` reduces every lit module to its emission aperture and
sums `E = I(theta) * cos(phi) / r^2` over a 24 x 16 grid on the wall and on the floor,
on top of the inter-reflected cavity bounce. The 2D Wall Studio gains an **Iso-Lux Map**:
a basalt to alabaster false-colour field with 100 / 250 / 500 lx contours, Peak, Avg and
Uniformity callouts and a live cursor probe. The 3D Room Planner gains a **Floor Lux
Grid** laid on the slab, mirrored in the scene graph and the summary bar.

v3.0.0 bound the cloud library to the account, not
the browser: the client sends its session as a Bearer token, the server resolves a
deterministic `acct-` namespace from the signed address, and sign-in moves the guest
library built before it into the account, so a project saved in one browser opens in any
other signed in with the same address. E2E runs write their own store file, so
`npm run dev` and `npx playwright test` can run side by side. Both planners gain an
**Acoustics & Illuminance** readout: average floor illuminance by the lumen method with
an inter-reflection term, graded Ambient Lounge, Residential Balanced or Studio Task, and
Sabine RT60 with the damping each acoustic frame adds. Spec sheets gain a fourth drawing,
**Exploded Assembly**: anchor, 24V bus core, body and optic pulled apart along the Z
axis by an **Explosion Spread** fader that animates outside React at any refresh rate.

v2.0.0 made Lumen Cloud a real HTTP API. A zero-dependency Node
server in `server/` validates every project and requisition with the same modules the
browser uses, prices quotes again from the catalog, issues the `LMN-R-` reference and
persists each browser profile's library atomically to `server/.data/lumen-cloud.json`.
Vite mounts it on `/api` in dev and preview, so the strict `connect-src 'self'` policy
holds unchanged, and `npm run server` runs it standalone. Sign-in opens an HMAC-signed
session that Sign Out revokes. The client keeps its signatures and error codes, mirrors
the server into `localStorage` for offline use, pushes offline saves on the next
contact, and `/account` reports the live transport.

v1.2.0 taught both planners to route the 24V DC bus: a daisy-chain from
the driver feed through every lit module, drawn on the 2D elevation with node order and
run lengths, and summarised in both planners as run length, bus current and worst-case
voltage drop against the 3% SELV limit. A **Share Link** key packs a wall or room and its
project name into a compact `?scene=` URL that opens the same scene anywhere, and the
checkout sheet gains an installation schedule: wall anchors, linear span, 24V trunk
cable and SELV circuits.

v1.1.0 made Lumen Cloud a named project library: each planner
saves under a project name, up to 12 walls and rooms live side by side with their own
revisions, and `/account` deletes them. A glass command palette (`Ctrl+K` / `Cmd+K`, or
the navbar search pill) reaches every workspace, all 8 modules and the mode, currency
and cart commands from the keyboard. Navbar links warm the planner chunks on hover or
focus, and the 3D Room Planner exports the room, its reference furniture and every
mounted module as a Wavefront `.obj` in centimetres.

The flagship release, v1.0.0, moved the app onto an asynchronous client
(`src/api/client.js`): walls and rooms save to Lumen Cloud as revisioned projects,
requisitions submit through the same layer, and `/account` reads both back behind a
loading state. The two planners load as their own chunks behind a centered loading frame.

## Release history

| Version | Scope |
| ------- | ----- |
| v3.5.0  | Per-module DALI-2 dimming across physics, lux, bus and WebGL, four scene presets, 3D undo |
| v3.4.0  | 1:20 ISO A3 blueprint sheet, drilling and anchor schedule, SVG and AutoCAD R12 DXF export |
| v3.3.0  | CAD multi-select and marquee, group move, align and distribute, smart alignment guides, hardened CI |
| v3.2.0  | Six-band octave RT60 and STI, 12-part catalog (pendant, baffle, sconce, DALI-2 hub), MIT license |
| v3.1.0  | Point-by-point photometric field, Iso-Lux Map with contours and cursor probe, 3D Floor Lux Grid |
| v3.0.0  | Session-bound account libraries with guest claim, isolated E2E store, Sabine RT60 and lux engine, exploded assembly drawing |
| v2.0.0  | Lumen Cloud HTTP API in `server/`, atomic JSON persistence, signed sessions, dual-transport client with offline sync |
| v1.2.0  | 24V DC bus topology overlay and telemetry, shareable `?scene=` links, checkout installation and anchor schedule |
| v1.1.0  | Named cloud project library with delete, Ctrl+K command palette, hover and focus chunk prefetch, Wavefront OBJ export |
| v1.0.1  | Camera settings popover pinned inside the 3D stage, explicit room layout layers, occlusion-checked E2E |
| v1.0.0  | Async Lumen Cloud client, revisioned project saves, cloud requisitions, empty states, planner code splitting |
| v0.10.1 | Cart naming on every visible label, toast and announcement |
| v0.10.0 | Hero inset and cap, glass pill navbar, bento account page, product card entrance |
| v0.9.0  | White and silver contrast, bento tiles, spring-driven card tilt with a CCT glow |
| v0.8.0  | Cinematic blur-scale reveals, 160-200px section rhythm, glass toast pills |
| v0.7.0  | WebGL room on React Three Fiber, auth shell, protected `/account`, toasts |
| v0.6.0  | Scroll reveals, tactile keys, glass planner panels, camera popover |
| v0.5.0  | Spec sheets with orthographic views and photometry, project checkout and quote engine |
| v0.4.0  | 3D Room Planner, 2D wall bridge, brand mark, Arch / Tech switch |
| v0.3.0  | 2D Wall Studio, wall to cart sync, frame-rate independent pendant physics, CI |
| v0.2.0  | Product dataset, filterable catalog, cart with driver sizing, surface lab |
| v0.1.0  | Design tokens, routing shell, security foundation, E2E harness |

## Stack

- Vite 8, React 19, React Router 7 (data router)
- Playwright for end-to-end verification against the production build
- Inter Tight and IBM Plex Mono, self-hosted through Fontsource (no third-party requests);
  the build preloads the three Latin faces so text never reflows after first paint
- Room engine: three.js r187 through React Three Fiber 9 and drei 10 (OrbitControls,
  Edges, Html), shipped only in the lazy `RoomCanvas` chunk
- Data layer: Promise-based Lumen Cloud client in `src/api/` over `fetch`, served by the
  zero-dependency Node API in `server/` (`node:http`, `node:fs`, `node:path`,
  `node:crypto`), with a `safeStorage` mirror for offline use

## Layout

```
index.html              CSP meta policy, favicon, entry point
vite.config.js          build config, dev-only CSP relaxation for HMR
.github/workflows/      ci.yml: install, Chromium, build, Playwright on main pushes and PRs
src/
  main.jsx              boot: fonts, tokens, persisted display mode, router
  router.jsx            route table, lazy planner routes, per-entry history key seeding
  api/client.js         Lumen Cloud client: saveProject, loadProjects, deleteProject,
                        submitQuote, loadQuotes, openSession, closeSession over
                        /api/*, device mirror, sync marker, transport telemetry
  components/           LayoutShell, Navbar, Footer, BagProvider, BagDrawer,
                        AuthModal, CommandPalette, ModeSwitch, ProductCard,
                        ProductElevation, SurfaceLab, PageHeader, WorkspaceFrame,
                        BlueprintViews, ExplodedAssembly (lazy) and
                        ExplosionSpreadControl, PhotometricCurve, CloudSaveButton,
                        ProjectNameField, EmptyState, BusTelemetryCell,
                        EnvironmentalPhysicsCell,
                        RouteFallback (loading frame and chunk error), icons
    studio/             WallStage, StudioPalette, StudioInspector, StudioToolbar,
                        BlueprintSheetModal,
                        StudioSummary, shared field, switch and finish controls
    room3d/             RoomViewport, RoomCanvas (lazy WebGL), RoomControls,
                        RoomInspector, RoomToolbar, RoomSummary, CameraSettings
  contexts/             AuthContext (session, RequireAuth), ToastContext
  data/                 products.js (parts, finishes, categories), wall-presets.js
  pages/                Home, Catalog, ProductDetail, Checkout, RoomPlanner,
                        WallStudio, Account, NotFound
  hooks/                useAmbientLight, useBag, useCardTilt, useCloudSave,
                        useCommandPalette, useCurrency, useDisplayMode,
                        useDocumentTitle, useLaunchedModule, useMagneticField,
                        useModalDialog, useProjectName, useSceneShare,
                        useRoom3d, useScrollReveal, useWallStudio
  lib/                  bag store and PSU sizing, wall studio geometry and history,
                        room model and 2D bridge (room-3d), WebGL scene description
                        and orbit frame (room-scene), Wavefront OBJ writer
                        (obj-export), 1:20 blueprint sheet compiler and SVG
                        (blueprint-sheet), AutoCAD R12 DXF writer (dxf-export),
                        named project ids (project-library), palette
                        index and ranking (command-index), credentials and session
                        token rules (auth), cloud record rules shared with the
                        server (cloud-records),
                        closed-form spring, display mode and currency stores,
                        photometry and intensity model, 24V bus electrical model,
                        daisy-chain routing and drop (bus-topology), illuminance
                        and Sabine RT60 (room-physics), point-by-point lux
                        field and iso-lux contours (illuminance-field), share link
                        codec (scene-codec), clipboard with fallback,
                        quote engine, formatting, nav routes, lazy chunk loaders
                        and prefetch (route-manifest)
  security/sanitize.js  safeJsonParse, safeStorage, input validators
  styles/               tokens, base, animations, shell, toast, home, pages, product,
                        product-detail, checkout, studio, room3d, account, cloud,
                        command-palette, empty-state
server/                 Lumen Cloud HTTP API, shared with Vite dev and preview
  app.js                request handler: routes, 64 KB JSON bodies, sessions, headers
  store.js              per-namespace state, account namespaces, atomic claims,
                        serialized transactions, atomic writes
  config.js             environment, data file path (dev or test), one store per process
  index.js              standalone server (npm run server)
  .data/                runtime stores, git-ignored: lumen-cloud.json (dev),
                        lumen-cloud.test.json (preview under Playwright)
tests/                  Playwright specs, named by architectural domain
  support/              shared runtime, CSP and overflow guards
```

## Routes

| Path         | View          | Role                                                      |
| ------------ | ------------- | --------------------------------------------------------- |
| `/`          | Overview      | Pendant hero, surface and dimming lab, core modules       |
| `/catalog`   | Catalog       | Category, search and sort over 12 parts, finish swatch    |
| `/catalog/:id` | Spec sheet  | Orthographic set, exploded assembly, photometry or bus curve, launchers |
| `/checkout`  | Project Quote | BOM, driver, currency, trade code, print, export, submit  |
| `/room-3d`   | Room Planner  | Lazy chunk. WebGL room, clearances, 2D bridge, cloud save, cart sync |
| `/studio-2d` | Wall Studio   | Lazy chunk. To-scale elevation planner, cloud save, cart sync |
| `/account`   | Account       | Signed in only: cloud projects and submitted requisitions |

## Lumen Cloud API

`src/api/client.js` is the only module that persists projects and requisitions. Every
call goes over `fetch` to the same-origin `/api/*` server and settles no sooner than
`LATENCY_MS.min` (500 ms) after it started, so saving and syncing states never flash on
a fast link. Requests time out after 8 s.

### Endpoints

| Method and path | Body | Answer |
| --------------- | ---- | ------ |
| `GET /api/health` | | `{ ok: true, version: '3.5.0', storage: 'server' }` |
| `POST /api/auth/session` | `{ email, password }` | `201 { token, expiresAt, user: { name: 'Studio Guest', email }, library: { scope: 'account', claimed: { projects, quotes } } }` |
| `GET /api/auth/session` | `Authorization: Bearer` | `200 { user, expiresAt }` or `401` |
| `DELETE /api/auth/session` | `Authorization: Bearer` | `204`, revokes the token |
| `GET /api/projects` | | `{ projects }`, newest first, at most 12 |
| `POST` or `PUT /api/projects` | `{ kind, name, data }` | `201` new or `200` revised: `{ project, projects }` |
| `DELETE /api/projects/:id` | | `{ projects }`, idempotent |
| `GET /api/quotes` | | `{ quotes }`, newest first, at most 24 |
| `POST /api/quotes` | `{ quote: { items, currency, promo, includeDriver, grossMinor }, project }` | `201 { quote, quotes }` |
| `POST /api/sync` | `{ mode, projects?, quotes? }` | `{ projects, quotes }` |
| `POST /api/test/reset` | | only with `LUMEN_TEST_RESET=1`: clears the caller's namespace |

- Signed out, every data endpoint is scoped by the `X-Lumen-Client` header: a 128-bit
  hex id the client generates once per browser profile and keeps under
  `lumen_cloud_client_v1`. Two profiles never see each other's library, so parallel E2E
  workers and browser contexts are isolated without a reset. Signed in, the same
  endpoints serve the account library; see Session-bound libraries.
- The server validates with the browser's own modules: `src/lib/cloud-records.js`
  (record rules, library and quote caps), `wall-studio.js` and `room-3d.js` (layout
  envelopes), `quote.js` and `bag.js` (pricing, promo codes, orderable parts),
  `project-library.js` (names and ids) and `auth.js` (credentials). Where the browser
  sanitizer drops a bad module silently, the API refuses the whole layout instead.
- Quotes are priced again on the server from the submitted parts, currency, promo and
  driver choice. `grossMinor` from the client is a cross-check only: a mismatch answers
  `409 stale`. The server issues the `LMN-R-XXXXXXXX` reference from `node:crypto`.
- Errors are JSON `{ error: { code, message } }`: `400 invalid`, `401 unauthorized`,
  `404 not_found`, `405 method_not_allowed` (with `Allow`), `409 quota` or `stale`,
  `413 payload_too_large`, `415 unsupported_media_type`, `503 storage`.

### Session-bound libraries

- With a server session the client adds `Authorization: Bearer <token>` (from
  `lumen_session_token_v1`) beside `X-Lumen-Client` on every `/api/*` call. The server
  verifies the HMAC signature, expiry and revocation, then resolves the library from
  the signed address: `acct-` plus the first 160 bits of
  `SHA-256("lumen.account.v1:" + email)`. The id is stable across restarts and session
  keys, so any browser signed in with the address reaches the same library.
- Claim. `POST /api/auth/session` moves the caller's browser-profile library into the
  account in one atomic write and reports `library.claimed`; the sign-in toast says
  what moved. Every later authenticated call repeats the claim, so a sketch saved as a
  guest after signing out joins the account on the next signed-in call. Projects match
  by id (the newer save wins, the revision never goes backwards), quotes by
  requisition ref. Records past the 12-project or 24-quote cap stay in the guest
  namespace instead of being dropped.
- Shared library, careful sync. A browser-profile mirror still replaces its namespace
  on `/api/sync`; a diverged mirror pushed to an account only ever merges, so one
  device cannot erase what another saved. The sync marker records which library the
  mirror was reconciled against, and a mirror left by another account is never pushed
  anywhere: the server list replaces it.
- A Bearer token the server no longer honours (expired, revoked, or signed by another
  process key) answers `401 unauthorized`, never a silent downgrade. The client drops
  that token, reruns the call on the browser-profile library and keeps the visitor
  signed in on this device; `/account` then reports **Library: This browser profile**.
- Requests without a Bearer token, including every v2 client, behave exactly as before.

### Persistence

- State lives in `server/.data/lumen-cloud.json` (git-ignored; `LUMEN_DATA_FILE`
  overrides it, `LUMEN_STORAGE=memory` skips disk). With `LUMEN_TEST_RESET=1`, which the
  Playwright web server sets together with an explicit `LUMEN_DATA_FILE`, the default is
  `server/.data/lumen-cloud.test.json`, so a dev server and an E2E run never race on
  one file. Mutations run one at a time against
  a draft; the snapshot is written to a temp file, flushed and renamed over the live
  file, and only then committed to memory and answered. A failed write leaves the file
  and the served state untouched and answers `503 storage`. Renames retry briefly when
  Windows, OneDrive or a scanner holds the file.
- Every record read from disk passes the same validators as a request body. An
  unreadable store is moved aside, never overwritten. At most 512 namespaces are kept,
  least recently written first out.

### Client contract

| Call | Resolves with | Mirror key |
| ---- | ------------- | ----------- |
| `saveProject(kind, data, { name })` | `{ id, kind, name, revision, savedAt, data }` | `lumen_cloud_projects_v1` |
| `loadProjects()` | saved projects, newest first, at most 12 | `lumen_cloud_projects_v1` |
| `deleteProject(id)` | the remaining projects, newest first | `lumen_cloud_projects_v1` |
| `submitQuote({ quote, project })` | `{ ref, quoteId, submittedAt, reference, preparedFor, currency, grossMinor, lines, loadW, status }` | `lumen_cloud_quotes_v1` |
| `loadQuotes()` | requisitions, newest first, at most 24 | `lumen_cloud_quotes_v1` |

- A named library of up to 12 projects (`MAX_STORED_PROJECTS`). The name (one line, at
  most 48 characters) maps to a deterministic id: the default names **Wall A** and
  **Room** keep the original `wall` and `room` ids, any other name becomes
  `<kind>-<slug>` (`wall-north-elevation`). Saving an existing id bumps its revision
  (`Rev 01`, `Rev 02`) and updates its name, time and payload. A new name on a full
  library is refused with a `quota` fault instead of evicting an older project.
- The payload is snapshotted and sanitized when the call is made, so edits made during
  the round trip never leak into the saved revision. Empty walls and rooms are rejected.
- `deleteProject(id)` validates the id, removes the record after the round trip and is
  idempotent: an id that is already gone resolves too.
- Every read is rebuilt record by record. Records written before v1.1.0 carry no id or
  name and read as the default project of their kind. An id that does not belong to the
  record's kind, unknown kinds, revisions outside 1-9999,
  non-ISO timestamps, payloads that fail the `lumen.wall` or `lumen.room3d` sanitizers,
  malformed requisition or quote ids, unknown currencies and unknown statuses are dropped.
- Failures reject with `ApiError` (`code` is `invalid`, `quota` or `storage`) and
  surface as a Fault toast. Nothing is written on failure.
- After every answer the `localStorage` mirror is reconciled to the server list, and a
  fingerprint under `lumen_cloud_sync_v1` records the mirror state that matched. A
  mirror changed on this device since then (an offline save, a v1 library) is pushed to
  `/api/sync` before the next call: projects replace a browser-profile library and merge
  into an account library (batched under the 64 KB body cap), quotes only merge, and a
  requisition the API issued is never rewritten by a device.
- When `/api/*` is unreachable or answers with anything but JSON (a static host),
  projects save, delete and load on the device mirror and the toast says so; a
  requisition is refused with a `storage` fault rather than issued offline. Nothing
  rejects unhandled.
- The planners keep their working draft in `lumen_wall_studio_v1` and `lumen_room_3d_v1`,
  so the 2D / 3D bridge, launchers and reloads behave as before. A cloud save is an
  explicit, revisioned commit of that draft.

### Cloud sync UI

- A **Project name** well sits above the save keys in both planners (default **Wall A**
  or **Room**). The name is kept beside the local draft (`lumen_project_names_v1`), so a
  reload or a trip through another view keeps it, and the save toast names the project.
  Opening a project from `/account` checks out its name with its revision.
- **Save to Cloud** sits beside the cart sync key in both planners. On press it settles
  flat, disables itself, shows a 1px spinning arc and reads **Saving to Lumen Cloud...**.
  On success it inverts to white with a drawn check and reads **Project Saved** for 2.4 s,
  and a toast confirms the revision. A ref lock backs up the disabled state, so a burst
  of clicks commits one revision. All labels share one grid cell, so the key never
  changes width.
- **Submit Project Requisition** in checkout follows the same pattern
  (**Submitting to Lumen Cloud...**) and shows the confirmation once the call resolves.
- `/account` shows shimmering placeholder rows and **Syncing with Lumen Cloud...** while
  both lists load in parallel. The profile tile reports the transport
  (**Lumen Cloud API (HTTP)** or **Device storage (offline)**, with the measured round
  trip on `data-round-trip-ms`), the library (**Account (session-bound)** or **This
  browser profile**) and the sync state (**Up to date** or **Device copy**).

## Code splitting

- `RoomPlannerPage` and `WallStudioPage` load through `React.lazy`, each behind its own
  `<Suspense>` boundary. The overview, catalog, spec sheets, checkout and account never
  download planner code. `three`, React Three Fiber and drei stay in the `RoomCanvas`
  chunk, which the room viewport loads on demand. The overview hero is CSS and
  canvas-free, so the home page never touches WebGL.
- Intent prefetch. `src/lib/route-manifest.js` holds the lazy loaders and exports
  `prefetchRoute(path)` (re-exported from `router.jsx`). The **3D Room** and **Wall
  Studio** navbar links call it on pointer enter and on focus, and the command palette
  calls it when a workspace is highlighted, so the chunk is cached before the click. The
  room planner also warms its WebGL chunk behind the page. Each path is fetched once per
  session, and nothing is prefetched when the browser reports Save-Data or a 2G link.
  A cold load of `/` still requests zero planner or WebGL chunks.
- The fallback is a frame centered in the main area: the Lumen mark under a sweeping
  mask highlight, a 160 x 1 px indeterminate bar and a mono label (**Loading spatial
  engine**, **Loading wall studio**). It enters with the cinematic focus reveal. On
  client-side navigation React Router keeps the current page up until the chunk is
  ready, so the frame appears only on a cold load.
- A failed chunk download (dropped connection, or a release that replaced the hashed
  files under an open tab) renders a route error with a **Reload** key instead of a
  blank frame. The navbar stays live.

| Build output (v0.10.1 to v1.0.0) | Before | After |
| -------------------------------- | ------ | ----- |
| Entry script | 518.0 kB / 158.3 kB gzip | 468.2 kB / 145.3 kB gzip |
| Entry stylesheet | 113.0 kB / 20.0 kB gzip | 83.7 kB / 15.6 kB gzip |
| Room planner chunk | in entry | 31.7 kB / 10.7 kB gzip |
| Wall studio chunk | in entry | 27.9 kB / 8.9 kB gzip |
| WebGL chunk (RoomCanvas) | 971.6 kB / 258.6 kB gzip | unchanged, lazy |

| Build output (v1.0.1 to v1.1.0) | Before | After |
| ------------------------------- | ------ | ----- |
| Entry script | 471.0 kB / 146.4 kB gzip | 481.8 kB / 149.5 kB gzip (palette, library) |
| Entry stylesheet | 85.5 kB / 15.9 kB gzip | 92.3 kB / 16.8 kB gzip |
| Room planner chunk | 34.9 kB / 12.0 kB gzip | 27.7 kB + 7.2 kB shared scene chunk |

| Build output (v2.0.0 to v3.0.0) | Before | After |
| ------------------------------- | ------ | ----- |
| Entry script | 490.3 kB / 151.9 kB gzip | 492.7 kB / 152.9 kB gzip (session binding, fourth tab) |
| Exploded assembly chunk | none | 9.3 kB / 3.9 kB gzip, lazy |

## Empty states

`EmptyState` pairs a hairline SVG drawing with one line of silver (`#a1a1aa`) copy and
the next action. Drawings use a 0.8 stroke on a 160-unit viewBox rendered at 200px, so
every line lands on one device pixel. Edges draw themselves in over 1.6 s and a single
tungsten aperture fades in last. Reduced motion shows the finished drawing.

| Where | Drawing | Copy | Action |
| ----- | ------- | ---- | ------ |
| Account, no projects | isometric wireframe cube with hidden edges | No spatial projects yet. | **Start 2D Wall Studio**, Open Room Planner |
| Account, no quotes | unissued spec sheet | No quotes submitted yet. | Browse Catalog |
| Checkout, empty cart | unfurnished wall elevation | No parts specified yet. | **Start 2D Wall Studio**, Browse Catalog |

## Design system

All values live in `src/styles/tokens.css`. Near-black basalt canvas (`#050505`), pure
white type (`--text-primary: #ffffff`) over silver body and data copy
(`--text-secondary: #b8b8b8`), tungsten amber (`#e8923a`) as the single accent,
anodized aluminum neutrals. Controls keep 2-4px radii; tabular-nums index labels
(`01 / OVERVIEW`). `--section-space` is 160px at 1280 wide and 200px from 1600, and
headlines run 640 weight against 350 weight ledes. From 1920px `--grid-max` widens to
1600px and the root type steps to 17px (18px and 1760px from 2400px), so copy holds on
2K displays. The 12-column structural grid sits behind the shell at 1% and fades out
down the viewport. Technical mode tints it amber, keeps it full height and reveals
measurement overlays; the choice persists through validated storage.

Bento tiles carry every major block below the hero. `.bento` (and the product card)
is `linear-gradient(145deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))` on a 16px
backdrop blur, a 1px `rgba(255,255,255,0.06)` edge and a 16px radius, the one exception
to the micro radii. Tiles sit on a tight 12-20px gutter (`--bento-gap`) so the air
between sections stays the dominant rhythm; inner stages such as product drawings and
workspace glyphs use 12px. The hero is a two-track grid: copy in a left track capped at
920px on a measured inset (`--hero-inset: clamp(24px, 9vw, 220px)`), the right track left
empty for the pendant. The headline uses `--text-hero`, `clamp(3rem, 1.2rem + 5.2vw,
7rem)`, tracked at -0.04em; the larger `--text-display` scale is no longer used by the hero.

Navbar controls share one pill key (`--pill-*` tokens): 32px tall, 24px radius,
`rgba(255,255,255,0.05)` fill on a 12px backdrop blur and a 1px `rgba(255,255,255,0.08)`
edge, set 8px apart and flush with the frame's right inset. Hovered Account and Cart pills
brighten their edge and rise 1px. Below 560px the pills tighten their padding so the row
fits a 360px phone.

The mark is a 24 x 24 monogram: structural spine, base return and a cantilevered shelf
slab in white, with a 2 x 6.5 tungsten aperture held between slab and base. It pairs
with `LUMEN` tracked at 0.14em; `public/favicon.svg` carries the same geometry on basalt.
The display mode switch is two pill segments inside a glass track, and the engaged one
inverts to solid white. Buttons, switches and badges never glow: light belongs only to
the simulated fixtures.

The hero light is a damped spring (`k = 90`, `c = 12`, slightly under-damped). Each rAF
frame advances it by the elapsed time, `dt = min((now - lastTime) / 1000, 0.05)`, using
the closed-form solution of the spring equation rather than an Euler step. The result is
exact for any `dt`, so a 60Hz panel, a 120Hz ProMotion display and a 240Hz monitor trace
the same curve with the same velocity and damping; the 50 ms cap keeps a backgrounded tab
from jumping on return. It writes `--light-x`, `--light-y` and `--light-energy` as CSS
custom properties, so React never re-renders on pointer movement.

## Motion

- Scroll reveal: `useScrollReveal` returns a ref for any reveal target. One shared
  `IntersectionObserver` (bottom margin -12%) fires it once, on
  `cubic-bezier(0.16, 1, 0.3, 1)`. Media (`.reveal-cinematic`: the surface lab, the
  account tiles) resolves from `scale(1.05)`, `blur(8px)` and zero opacity over
  1200 ms; copy (`.reveal-up`) rises 28px out of a 4px blur over 1100 ms.
- Card entrance: every `ProductCard` is its own reveal target (`.reveal-card`). It grows
  from `scale: 0.95` out of a 4px blur and zero opacity over 1000 ms on the same curve,
  wherever the card is placed. It animates the individual `scale` property, so the tilt
  transform composes with it, and runs as keyframes, so the card's own border and shadow
  transitions are left alone. Cards stagger through the nearest `.reveal-stagger`
  ancestor, so a grid still lands at 0, 100 and 200 ms. The rest state
  is `filter: none`, never `blur(0)`, so a settled element is not a containing block.
  Elements that enter in the same frame are ordered top to bottom, left to right, and
  each `.reveal-stagger` parent hands its children one 100 ms step apiece, so a row of
  three cards lands at 0, 100 and 200 ms. Once the opacity transition (or the card
  entrance animation) ends, `data-reveal-settled` drops the `will-change` hints. Content already scrolled past on
  a restored position appears without motion. The hidden state is gated on
  `html[data-reveal='on']`, set only when the observer exists.
- Hover: product drawings and workspace glyphs scale to 1.045 over 900 ms inside a
  clipped stage, so the card never changes size.
- Card tilt and glow: `useCardTilt` maps the pointer inside a product card to
  `perspective(1000px) rotateX() rotateY()`, at most 4 deg per axis, with the hovered
  corner lifting toward the viewer so a key under the pointer grows toward it. The tilt
  runs on the closed-form spring (`k = 170`, `c = 26`, just under critical) in a rAF
  loop that stops once settled, and is written straight to `style.transform`; at rest
  the inline transform is removed. The same loop writes `--glow-x`, `--glow-y` and
  `--glow-a` for a 380px radial glow behind the drawing, tinted by the fixture's CCT.
  Touch input is ignored; coarse pointers and reduced motion keep the glow and skip
  the tilt.
- Tactile keys: every `.button` lifts 2px on hover off a 4px plinth drawn as a zero-blur
  offset `box-shadow`. `useMagneticField` is one delegated pointer listener that pulls
  the hovered key toward a fine pointer by at most 4 x 3 px; the plinth stays where the
  key rests, so it trails the cap. Arrows slide 4px, the add glyph turns a quarter.
  Nothing glows: the plinth has no blur, and the glow guard in the E2E suite holds.
- `src/styles/animations.css` holds the reveal states and the shared keyframes (rise,
  settle, unfold, transient status lines). Under `prefers-reduced-motion: reduce` every
  section renders at rest, keys do not drift and status lines stay put.

## Catalog and cart

- `src/data/products.js` is the single source for parts: SKU, price, dimensions, 24V load,
  lumen output, CCT, CRI, mounting points, lead time and the finishes each part ships in.
  Finishes carry their hex ramp, LRV and gloss so the catalog drawings and the lab read
  the same values.
- Each catalog card draws a front elevation at the largest standard scale that fits
  (1:2 to 1:50). Architectural mode shows finish and editorial copy; technical mode adds
  dimension lines, anchor points and the telemetry grid (SKU, load, lm, lm/W, CRI).
- The navbar **Cart (n)** pill opens the cart drawer. Every visible label says cart:
  **Add to Cart**, **Clear cart**, **Sync Wall to Cart**, **Sync Room to Cart** and the toasts.
  Internally the store, hook, CSS classes, test ids and storage key keep the `bag` name.
- The cart is stored under `lumen_bag_v1` through `safeStorage`. Every read is rebuilt line
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
- The palette mounts any of the 12 parts at its catalog `dimsCm`, default finish, in the
  first clear position near its natural height (floor, eye level, ceiling). Three
  presets load collision-free compositions: Nordic Reading Wall, Acoustic Media Spine
  and Attic Study Alcove.
- Pointer drag is throttled to `requestAnimationFrame`, quantized to 1 cm (5 cm with
  snap) and clamped to the wall. Conflicts are flagged live: AABB overlap between
  modules, cuts into the slope (`x + y > W + H - 90` at the module's top-right corner)
  and modules larger than a resized wall. Arrow keys nudge, Shift multiplies by 10.
- Selection: `Shift + Click` toggles a module; a marquee dragged on bare wall selects
  every module it touches (`Shift` adds to the set); `Ctrl+A` / `Cmd+A` on the stage
  takes all unlocked modules; `Escape` clears. A selection drags and nudges as a rigid
  group: the shared translation snaps to the active step and is clamped by the most
  constrained member, so nothing leaves the wall. Locked members hold. `Delete` removes
  the unlocked members. Each group edit is one undo step.
- With two or more modules selected the inspector becomes **Multi-Selection (N modules)**:
  align left, centre, right, top, middle or bottom to the selection's bounding box;
  distribute three or more horizontally or vertically with the end modules fixed and the
  gaps equalized (centres, when the parts are wider than the span); batch finish, batch
  24V channel and batch remove.
- Smart guides (`computeSmartGuides`) run during every drag: a hairline with end ticks
  and a `CL`, `EYE` or `ALN` label appears wherever the dragged module's or group's left,
  centre, right, bottom, middle or top lies within 2 cm of the wall centreline, the
  145 cm eye-level datum or another module's edge or centreline. Solid amber marks an
  exact hit.
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
- **24V Bus** in the toolbar (always on in technical mode) draws the bus routing on the
  elevation: the `PSU 24V FEED` origin, orthogonal cable legs, node order `N01`, `N02`...
  and the run length of each hop. `computeBusTopology` in `src/lib/bus-topology.js`
  feeds from the utility datum (X 20 / Y 30 cm), or from the left end of the first
  mounted Track Bus 200. Lit modules and any further track join the chain by nearest
  neighbour (ties left to right, then bottom to top) at their feed point: the bottom
  centre, the canopy for ceiling spots, the left end cap for track. Each hop carries the
  current of every node after it on a 2 x 2.5 mm2 copper loop; the drop at the last node
  is checked against 3%. The overlay follows a drag live.
- **Blueprint** opens the issued drawing as a dialog. `compileBlueprintSheet(layout,
  { projectName, revision, dateIso })` returns a deterministic model: wall outline and
  slope cut, overall and running dimension chains, modules numbered in reading order
  (left to right, then bottom to top), anchors from the catalog mounting points sorted by
  module then left to right, the bus topology, and the title block (drawing `LMN-BP-01`,
  scale `1:20`, module and anchor counts, connected 24V load, recommended driver).
  `buildBlueprintSvg` lays it out on an ISO 5457 A3 frame at true 1:20 with
  architectural ticks, crosshair anchors, a dashed amber bus trunk, the schedule and the
  title block; every text node is XML-escaped. The dialog shows the sheet, the title block
  and a schedule table whose rows mark their crosshair on hover or focus.
  **Download .SVG Blueprint** saves `<project-slug>-blueprint.svg`; **Download AutoCAD
  .DXF** saves `<project-slug>-blueprint.dxf`: R12 (`AC1009`) with `HEADER`, `TABLES`
  (`LTYPE`, `LAYER`, `STYLE`), `ENTITIES` and `EOF`, one unit per centimetre, layers
  `LUMEN_WALL`, `LUMEN_MODULES`, `LUMEN_ANCHORS` (`CIRCLE` plus crosshair at each drilling
  point), `LUMEN_24V_BUS` (dashed), `LUMEN_DIMS` and `LUMEN_TITLEBLOCK`. Every DXF string
  is reduced to one printable ASCII line, so a project name cannot inject group codes.
- **Iso-Lux Map** beside it lays the point-by-point wall illuminance over the elevation:
  a log-scaled ramp from basalt through deep bronze and tungsten amber to warm alabaster
  (5 to 2,000 lx), dashed 100 lx and solid 250 / 500 lx contours, the hotspot reticle and
  `Peak`, `Avg` and `Uniformity` callouts. The attic slope is clipped out of the field
  and its statistics. Hovering reads the exact point law under the cursor
  (`Probe 693 lx @ X 93 / Y 142`), written to the DOM outside React. The field follows a
  drag and a nudge cm for cm.
- The summary reports modules, connected 24V load, live flux, price, driver, the bus
  run (`Run 9.4 m / 4.50 A / 0.26 V drop (1.1%)`) and **Acoustics & Illuminance**
  (`Illuminance: 459 lx (Studio Task)`, `RT60: 1.52 s`); see Acoustics and illuminance. **Sync
  Wall to Cart** groups modules by part and finish, merges them into the shared cart and
  opens the drawer, where the PSU is sized on the full connected load.

## Room Planner

- Rooms run 240-500 cm wide, 200-450 cm deep and 220-320 cm to the ceiling (default
  320 x 280 x 250 cm). The main wall sits at Z 0 and shares Wall Studio coordinates:
  `Left X` and `Bottom Y` in cm, modules extruded to their catalog depth.
- WebGL engine. `src/lib/room-scene.js` is a pure scene description: it turns the room
  state (cm) into mesh, material and light records in metres, deterministic and
  testable without a GPU. `RoomCanvas.jsx` maps those records onto React Three Fiber:
  `BoxGeometry` and `CylinderGeometry` primitives with `MeshStandardMaterial` in the
  finish colour (Walnut, Oak, Obsidian, Chalk; timber matte, obsidian with a soft
  sheen), single-sided interior wall planes that cull themselves once the camera orbits
  past, and section-cut poche slabs that hide the same way.
- Lighting: ambient and hemisphere fill plus a directional sun with a 1024 px PCF shadow
  map. Every lit module adds its own light in its CCT: a `SpotLight` washing the wall
  below shelves, cubes, sideboards, lightbars (up and down) and the monopoint spot, a
  `PointLight` for the floor column and the backlit art frame halo. Intensity scales with
  rated lumens. Switching the 24V channel off removes the light and darkens the emitter.
- Camera: drei `OrbitControls` (no pan, no damping) clamped to yaw -65 to 65 deg, pitch
  8 to 50 deg and zoom 0.6-1.8x through azimuth, polar and distance limits. A drag
  commits on release, wheel zoom after a 180 ms pause; the committed yaw / pitch / zoom
  persists and drives the lens back, so presets, keys and reloads land exactly.
- Presets (Perspective, Front Elevation, Corner Iso, Reset Camera) glide in on the
  closed-form spring, critically damped. The arrow keys, `+`, `-` and `Home` drive the
  camera from the keyboard. Modules are picked by raycast; a drag never selects.
- The canvas renders on demand (`frameloop="demand"`), only when the scene, the camera or
  its size changes. The three.js chunk loads lazily; until it arrives, or when the
  browser has no WebGL context, the viewport shows a plain notice while the inspector,
  camera HUD, cart sync and 2D bridge stay fully live.
- A hidden scene-graph mirror beside the canvas lists every module, light, furniture
  part, selection, conflict and annotation with the data the GPU draws, plus each
  module's projected screen position. The E2E suite reads it, so it runs with or
  without WebGL in CI.
- The camera controls float over the scene as glass pills: presets and reset on the
  left, zoom and a **Camera settings** fader button on the right. The popover holds the
  live readout, Yaw, Pitch and Zoom faders (sanitized through `sanitizeCamera`) and a
  **Wireframe** switch that turns materials to smoked glass and outlines every box and
  the room. It closes on Escape, a second press or any press outside. The fader button
  pins to the right edge of the HUD on whichever row it wraps to, so the right-anchored
  panel always opens inward over the stage; the room column sits on its own layer above
  the controls and inspector and below the navbar.
  Wireframe is view state for the session; the camera persists. Below 768px the HUD
  docks above the scene. While the room is orbited the surrounding panels step back.
- Room dimensions fold into a **Dimensions** summary row like the Wall Studio's.
- Floor references: Low Platform Bed 160cm, Architect Desk 140cm, Modular Sofa 200cm.
  Modules are tested against them as true 3D boxes, so an art frame can hang behind a
  sofa back while a sideboard cannot.
- Night Ambient (2700K) or Daylight Studio. The room surfaces stay the same; night drops
  the fill to a dim moonlit sun so the LED washes carry the room, daylight raises the
  sun and fill until the fixtures read as accents.
- Technical mode adds edge outlines (hidden edges drawn faint through the solids), X / Y
  / Z axes in cm, SKU tags and clearance callouts: walkway, headroom over the furniture,
  floor and ceiling. Labels are DOM elements projected over the canvas.
- **Load from 2D Wall Studio** reads `lumen_wall_studio_v1`, or the Nordic Reading Wall
  when it is empty. **Push to 2D Wall Studio** writes the main wall back, capped at the
  400 cm studio width. **Sync Room to Cart** merges the modules and opens the drawer.
- **Export 3D .OBJ** writes `lumen-room-<name>.obj` through `buildRoomObj(state, name)` in
  `src/lib/obj-export.js`: a `# Lumen 3D Export` header, six shared `vn` axis normals,
  then one `o` object per surface group. `room_envelope` is the floor and three walls
  facing into the room; each reference furniture part is a box
  (`furniture_sofa-200_back`); each module is its catalog box (`dimsCm.w x h x d`) at its
  `xCm`, `yCm` wall position (`module_01_LMN-SH-110_floating-shelf-110`). Units are cm in
  the room frame (x along the main wall, y up, z into the room), which Y-up CAD and DCC
  tools import as is. Faces are quads wound counter-clockwise around their normals.
  Object names are single tokens of `[A-Za-z0-9_-]`; free text only reaches comment
  lines, reduced to printable ASCII.
- The summary carries the same 24V bus run readout for the main wall, and the
  Acoustics & Illuminance readout for the whole room volume, its lighting mode and its
  floor reference.
- **Floor Lux Grid** in the camera settings popover lays the floor illuminance field on
  the slab as a false-colour texture with iso-lux contours and a `Peak` label at the
  hotspot. The hidden scene graph mirrors it as `room-floor-lux` (peak, average, minimum,
  uniformity, hotspot, iso-lux coverage) and the summary bar adds a Floor Lux Grid cell.
- State persists under `lumen_room_3d_v1` and is rebuilt on every read with the wall
  layout's per-module rules plus a clamped envelope, furniture, lighting and camera.

## Acoustics and illuminance

`computeEnvironmentalPhysics(layoutOrRoom)` in `src/lib/room-physics.js` is pure and
deterministic: only which parts are mounted, their finish and their 24V channel enter
it, never their position. A 3D room is its own width x depth x height; a 2D wall is
read as the front of a reference zone 260 cm deep, minus the attic slope prism.

- Illuminance, lumen method. Each lit module sends a share of its flux straight to the
  floor (0.6 for a shelf under-lip, 0.1 for the frame's rear halo), and all flux then
  inter-reflects as an integrating sphere: `E_r = MF * phi * rho / (S * (1 - rho))`,
  maintenance factor 0.8. `rho` is area-weighted over floor (LRV 0.20), ceiling (0.80)
  and walls (0.35 in Ambient or Night, 0.70 in Daylight), with each wall module's face
  carrying its finish LRV. `avgFloorLux` grades **Ambient Lounge** (<100 lx),
  **Residential Balanced** (100-250 lx) or **Studio Task** (>250 lx);
  `avgWallLux` and coverage of the 300 lx `taskTarget` (EN 12464-1 reading) ride along.
- Reverberation, Sabine in six octave bands (`OCTAVE_BANDS`, 125 Hz to 4 kHz):
  `RT60 = 0.161 * V / (A + 4mV)`. The baseline `A` is the bare envelope plus the
  reference furniture, each with its own coefficient per band (500 Hz values: timber
  floor 0.10, plasterboard ceiling 0.05, painted walls 0.03; sofa 1.4, bed 1.6, desk
  0.15 m2 sabins). Timber and the plasterboard ceiling absorb most at 125-500 Hz; the
  air term `4mV` (ISO 9613-1) only enters at 1 kHz and above. A mounted module adds its
  face at its own coefficient in place of the wall it covers: the Acoustic Art Frame
  50x70 puts its 40 x 60 cm 30 mm felt core in at NRC 0.70, the Acoustic Wall Baffle 120
  its 117.6 x 32.6 cm 50 mm core at NRC 0.85, both strongest from 500 Hz to 4 kHz.
- `octaveRt60` and `baselineOctaveRt60` hold the six bands in seconds. `rt60Sec` is the
  500 Hz reference band: one frame on the default wall reads `RT60: 1.44 s` and
  `-0.12 s damping`; `acousticDeltaSec` is computed from the rounded figures so the
  readout always adds up.
- Speech Transmission Index, reverberation only: per band, `m(F) = 1 / sqrt(1 + (2 pi F T
  / 13.8)^2)` over the 14 IEC 60268-16 modulation frequencies (0.63-12.5 Hz), mapped to
  an apparent SNR clipped to +/-15 dB and averaged to a transmission index, then
  weighted toward 2 and 4 kHz. `stiScore` (0.00-1.00) grades **Poor** (<0.45), **Fair**
  (0.45-0.60), **Good** (0.60-0.75) or **Excellent** (>=0.75). The default wall reads
  `STI 0.54 (Fair)`; a baffle and a frame lift it to 0.58.
- The six-bar spectrum (`acoustic-octave-spectrum`, one fixed 2.5 s scale) and the
  derivation (`V`, `A` in m2 sabins, `rho`, wall lux, task coverage) appear under the
  readout in Technical mode only.

### Point-by-point field

`computeWallLuxField(layoutOrRoom, options)` and `computeFloorLuxField(roomOrLayout,
options)` in `src/lib/illuminance-field.js` sample a deterministic grid (24 x 16 by
default, 4 to 96 per axis) at cell centres. A 2D wall is read over its 260 cm reference
zone; floor fields report plan coordinates, `y` measured out from the main wall.

- Every module with `watts > 0` and `led !== false` becomes its emission aperture, matching
  the emitter strips of the 3D scene: the shelf's front lip 23 cm out, the cube's top
  panel, the sideboard's underside, the lightbar's opal face, the column's bilateral slot,
  the spot's canopy, the frame's rear halo channels, the pendant's microprismatic
  underside and the sconce's open blade ends (one lobe down, one up). Lines split into
  2.5 cm segments.
- Each segment carries an equal share of its lobe, `I(theta) = I0 * cos^m(theta)` with
  `I0 = phi * (m + 1) / (2 * pi)` from `src/lib/photometry.js`, scaled by the 0.8
  maintenance factor. A point on a surface with normal `n` receives
  `E = I(theta) * cos(phi) / r^2`, `r` in metres and clamped at 2 cm.
- The uniform term is `reflectedLux` from `computeEnvironmentalPhysics`, so an unlit
  corner still reads the cavity bounce, and a room with every channel off reads 0 lx.
- Statistics: `peakLux`, `minLux`, `avgLux`, `uniformityRatio` (EN 12464-1 U0, minimum
  over average), `diversityRatio` (average over peak) and the share of the surface at or
  above 100, 250 and 500 lx. The hotspot is refined on a 1 cm lattice around the
  brightest cell, so it moves exactly with the module that casts it.
- `isoLuxContours` traces the three levels by marching squares; `fieldImage` upsamples
  the grid bilinearly into the ramp for the 2D canvas and the 3D floor texture alike.

## Spec sheets

- Every catalog and overview card title links to `/catalog/:id?finish=<id>`. Unknown or
  malformed ids render a not-found state; a finish the part does not ship in falls back
  to its default.
- Three procedural SVG views at the largest standard scale that fits (1:1 to 1:50):
  Front Elevation, Side Section (Z depth, cut hatch, 12 x 8 mm 24V bus channel, wall or
  plaster datum) and Mounting & Anchor Detail (rear view, chained anchor centres in cm,
  fixing schedule). Anchors come from the same function the Wall Studio draws with.
- A fourth tab, **Exploded Assembly**, draws the part in cabinet oblique (depth recedes
  at 30 deg, half scale) as four sub-assemblies: **01** the fixing (Wall Anchor &
  Concealed Steel Cleat with its anchor centres; floor plate, ceiling canopy or
  plaster-in clip for the other mounts), **02** the 24V DC copper bus and connector
  core, **03** the primary structural body in the selected finish ramp with its
  dimensions, and **04** the optical diffuser and LED array in the part's CCT, or an
  anodized cover plate on passive hardware. Each layer carries a balloon; a parts list
  under the drawing names them with their spec. Layers leave the wall toward the viewer
  along the Z axis, so dash-dot alignment axes through the anchor centres stretch with
  them and every layer stays on its axis at any spread.
- The **Explosion Spread** fader runs 0% (assembled) to 100% (fully exploded), default
  65%, with **Assemble (0%)** and **Explode (100%)** keys. Input never goes through
  React state: a native listener aims a `requestAnimationFrame` glide that writes one
  `--spread` property on the drawing, weighted by `dt` so it settles in the same 0.9 s
  at 60, 120 or 240 Hz, and every translation, axis length and balloon fade is CSS
  derived from it. Balloons fade in from 18% so they never stack when assembled. The
  spread survives a trip through the other views. The drawing and fader ship as their
  own 9 kB chunk, fetched when the tab is hovered or focused.
- Photometry: each lobe is `I(t) = I0 cos^m(t)` with `I0 = flux (m + 1) / 2pi`, so the
  polar curve integrates back to the catalog lumens. The spot uses `m` solved from its
  36 deg beam. A probe slider reads intensity at any angle; on-axis lux at 0.5, 1.0 and
  2.0 m follows the inverse-square law.
- Parts without an LED channel (Track Bus 200, DALI-2 Bus Hub, Acoustic Wall Baffle 120)
  show the 24V feed instead: 6.25 A at 150 W, 2 x 2.5 mm2 copper,
  end-fed worst-case drop for 60 / 100 / 150 W against run length, and the run that
  stays inside a 3% drop.
- **Mount in 2D Wall Studio** and **Place in 3D Room** write the part, in the chosen
  finish, to the first clear spot in `lumen_wall_studio_v1` or `lumen_room_3d_v1`, then
  open the planner with that module selected. **Add to Cart** takes a quantity.

## Checkout and quote

- **Configure Quote & Checkout** in the cart drawer opens `/checkout`. The BOM lists every
  cart line plus the 24V driver sized on the connected load (60W, 150W or a multi-bus
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
  **Submit Project Requisition** validates the form, submits through `submitQuote` and
  shows the `LMN-R-` reference once Lumen Cloud confirms it.
- The sheet's **Installation & Hardware Schedule** totals wall anchors (catalog mounting
  points x qty), linear wall span (wall-hung and recessed parts), the 24V trunk cable
  allowance and SELV circuits (one per 150 W started; none for a passive cart). The cable
  allowance is a 3 m lead-in per circuit, plus the span, plus 0.5 m per powered part,
  rounded up to 0.5 m. It prints with the quote and ships in the JSON export.
- An empty cart renders the wall elevation empty state inside a bento tile.

## Share links

- **Share Link** in either planner encodes the workspace and project name into
  `<origin>/<planner>?scene=<Base64URL>`, copies it (Clipboard API, then an
  `execCommand` fallback; a blocked clipboard leaves the link on the key's
  `data-share-url`) and confirms with a toast. Payloads are positional arrays of part id,
  finish, X, Y and channel flags, at most 4096 characters.
- Opening a link loads the scene as one undoable step, adopts its project name, toasts
  `Loaded shared scene: <name>.` and strips `scene` from the address bar with a history
  replace, so a reload keeps later edits. Other query parameters survive.
- `decodeSceneParam` (`src/lib/scene-codec.js`) never throws. It refuses anything over
  4096 characters, outside the Base64URL alphabet, not UTF-8, not JSON, of the other
  planner's kind, carrying a `__proto__`, `constructor` or `prototype` key (escaped or
  not), or with any module that does not survive `sanitizeLayout` / `sanitizeRoomState`.
  A refused link keeps the local draft and shows `Shared scene link is invalid.`

## Account

- **Sign In** in the navbar opens a modal dialog (focus trap, Escape, focus returned) with
  Email and Password. The form validates locally (a plausible address and at least 8
  characters), then `POST /api/auth/session` opens an HMAC-SHA256 signed session valid
  for 12 hours. The server length-checks the password and discards it; the browser
  stores `{ name: "Studio Guest", email }` under `lumen_session_v1` and the token under
  `lumen_session_token_v1`. **Sign Out** revokes the token server-side. When the API is
  unreachable the visitor gets a device-only guest session and a toast says so. A
  tampered session payload reads as signed out and drops its token.
- Signing in binds the library to the account and moves the guest library into it
  (`Signed in as a@b.com. 1 project from this browser moved into your account
  library.`). Signing out of an account library says the projects stay in Lumen Cloud.
- Once signed in the trigger becomes an **Account** link. `/account` sits behind
  `RequireAuth` and redirects to `/` when signed out. The page is one bento grid under a
  fixed oak-amber wash (`--glow-oak`, a 5% `#e8923a` radial falling off by 40% from the
  top right). A full-width profile tile shows the name, email, transport, library, sync
  state and project and quote counts, with **Sign Out** on its top-right corner (below the identity
  on phones). Beneath it, **Saved Spatial Projects** (every named wall and room in the
  library as inset cards with an elevation thumbnail, envelope, module count, 24V load,
  driver, list price, save time and revision badge) sits beside **Order History**
  (submitted requisitions with status, lines, load and gross in the quoted currency).
- **Open in Wall Studio** and **Open Room Planner** check the saved revision and its name
  out into the planner's working draft, then open the planner. A draft that was never
  saved does not appear here: the account lists what was committed to the cloud.
- **Delete** on a card calls `deleteProject(id)`. While the call is in flight the card
  dims, reports `aria-busy`, and both of its keys lock (the key reads **Deleting...**
  at a fixed width). On success the card leaves, the profile's project count drops, a
  toast confirms it and focus lands on the panel title. On a narrow card the key takes
  its own full-width row under **Open**.

## Command palette

- `Ctrl+K` (or `Cmd+K`) anywhere opens a glass dialog (`role="dialog"`, 24px backdrop
  blur, 16px radius) that resolves in from scale 1.04 and an 8px blur. The same keys
  close it again; it never opens on top of the cart drawer or the sign-in dialog. The
  first navbar pill (`Search`, with the shortcut on a hairline key cap) opens it too and
  folds to its glyph below 560px.
- One search field ranks matches within three fixed groups: **Workspaces** (Overview,
  Catalog, 3D Room Planner, 2D Wall Studio, Project Quote, Account), **Modules** (all 12
  parts with SKU, 24V load and USD price; Enter opens the spec sheet) and **Commands**
  (Switch to Technical or Architectural Mode, Set Currency: USD, EUR or HUF, Open Cart
  Drawer). A label prefix outranks a word start, which outranks any other match, and
  every term has to land.
- Keyboard: `ArrowDown` / `ArrowUp` move and wrap, `Enter` runs, `Escape` closes, `Tab`
  stays inside. The field is an ARIA combobox over a grouped listbox with
  `aria-activedescendant`, so screen readers follow the highlight. Focus returns to
  whatever held it before the palette opened.
- The highlight is a flat lifted surface with a hairline edge; the current currency
  carries a razor-thin **Current** tag. Nothing glows.
- Currency is a shared store (`src/lib/currency-store.js`, `useCurrency`), so a command
  re-prices an open checkout immediately and persists under `lumen_currency_v1`.

## Notifications

- `ToastProvider` renders one polite live region, fixed 24px above the bottom edge and
  centred, at `z-index: 100`. Each toast is a translucent pill on a 28px backdrop blur
  with a hairline top highlight and a dark ambient shadow, never a coloured glow. It
  pulls into focus from a slight blur and scale, carries a tone label (OK, Note, Check,
  Fault) and a 1px countdown, and unmounts after 4 seconds; a dismiss key closes one
  early. The stack ignores the pointer except for that key, so a toast never blocks a
  control.
- `useToast().addToast(message, tone)` reports cart additions and removals, cleared carts,
  checkout requisitions and quote exports, cloud saves with their project name and
  revision, cloud deletes, cloud failures, planner saves (Wall Studio JSON export and
  import, room push to Wall Studio, room OBJ export), palette mode and currency
  commands, and sign in or out. Messages pass `sanitizeText` and
  render as text nodes.

## Security

- Production CSP: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'`
  and friends. No inline scripts, no eval. The dev server widens `script-src` and
  `connect-src` only for React Fast Refresh and the HMR socket. Builds ship the policy
  untouched, and the E2E suite runs against the build to prove it, WebGL canvas included.
- `safeJsonParse` strips `__proto__`, `constructor` and `prototype` at every depth, caps
  input length and nesting, and never throws.
- `safeStorage` namespaces keys under `lumen:`, validates every read, and degrades to a
  no-op when storage is blocked.
- `isSafeInternalPath`, `isSafeId`, `sanitizeText` and `clampNumber` cover URL, ID,
  free-text and numeric input.
- Shared `?scene=` links are length, alphabet, key and schema checked before any state
  changes; see Share links.
- The cloud client sanitizes every record it reads, so a tampered `lumen_cloud_*` value
  is dropped before it reaches React state.
- The API accepts at most 64 KB per body (`413`, drained without buffering, cut at
  1 MB more), only `application/json` (`415`), parses through `safeJsonParse`, so
  `__proto__`, `constructor` and `prototype` keys are stripped before validation, and
  answers every response with `X-Content-Type-Options: nosniff`, `Cache-Control:
  no-store`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a
  `default-src 'none'` CSP. No CORS headers are sent; the JSON content type and the
  `X-Lumen-Client` header force a preflight, so other origins cannot call it.
- Session tokens are compared in constant time; set `LUMEN_SESSION_SECRET` (32+
  characters) to keep sessions valid across restarts, otherwise each process signs with
  its own random key.
- Account libraries are reachable only through a verified session. The `acct-` prefix
  is reserved: an `X-Lumen-Client` header that names it is refused with `400`, so an
  address-derived namespace id cannot be used to read someone else's library. A
  presented Bearer token that fails verification answers `401`; only the `Bearer`
  scheme selects a session, so a staging proxy's Basic auth stays anonymous.

## Development

Requires Node `^20.19.0` or `>=22.12.0`.

```
npm install
npx playwright install chromium   # first run only
npm run dev                       # http://127.0.0.1:5173 (also http://localhost:5173)
npm run build
npm run preview                   # http://localhost:4173
npm run server                    # API only, http://127.0.0.1:8787/api
npx playwright test               # builds, serves preview, runs the E2E suite
```

`npm run dev` and `npm run preview` serve the API on `/api` in the same process. The
standalone server reads `HOST`, `PORT`, `LUMEN_DATA_FILE`, `LUMEN_STORAGE`,
`LUMEN_SESSION_SECRET` and `LUMEN_TEST_RESET`. Run one process per data file. The E2E
web server writes `server/.data/lumen-cloud.test.json`, so a dev server on the default
store can stay up during a test run.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests to `main` and
`develop`: `npm ci`, the Playwright Chromium binary, `npm run build`, then
`npx playwright test` against the built bundle. The HTML report is kept as an artifact.
`ubuntu-latest` already carries Chromium's shared libraries and every font is
self-hosted, so the job installs no apt packages and does not depend on Ubuntu mirrors.
Releases push `develop` and `main` at the same SHA; triggering pushes on `main` only, with
`concurrency` grouped by ref and `cancel-in-progress`, yields one run per release. Every
push is followed by a check of the run on the GitHub Actions API until it completes green.

## Workflow

- `main` holds releases, `develop` integrates, each milestone lands on a short-lived
  `feat/*` branch. Once `develop` and `main` are pushed, the feature branch is deleted
  locally and on `origin`, so only `main` and `develop` stay published.
- Only major releases are tagged: `v1.0.0`, `v2.0.0`, `v3.0.0`. Minor and patch releases
  ship untagged and are recorded in the release history above.
- Releases advance `develop` and `main` by pointer (`git branch -f`) from the finished
  feature branch, never by switching back first, so no working-tree directories are
  deleted on synced (OneDrive) folders.
- Lower-case Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `security:`, `docs:`.
- Test files are named by domain, for example `app-shell.spec.js`.

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 Lumen Spatial Studio Kft.
