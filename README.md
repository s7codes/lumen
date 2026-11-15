# LUMEN - Architectural Lighting, Modular Shelving & 3D Spatial CAD Platform (v9.0.0)

[![Playwright E2E](https://github.com/s7codes/lumen/actions/workflows/ci.yml/badge.svg)](https://github.com/s7codes/lumen/actions/workflows/ci.yml)
![Release](https://img.shields.io/badge/release-v9.3.0-e8923a)
![License: MIT](https://img.shields.io/badge/license-MIT-2a2825)

**Live production: [https://lumen.s7codes.dev](https://lumen.s7codes.dev)**, served from a Hetzner Cloud VPS
by the Docker Compose and Caddy kit in this repository.

| Playwright E2E | Rendering | AI integration | Backend |
| --- | --- | --- | --- |
| 329 tests against the production build | WebGL2 with custom GLSL shaders | JSON-RPC 2.0 MCP server and SSE agent | Zero-dependency hardened Node.js |

Current release: **v9.3.0**, the X-ray studio release. 03 / 3D Spatial Studio is one wide
instrument now: the warm 2K hero photograph and a 1:20 CAD elevation of the same wall, split by a
carbon divider that follows a drag, steps with the arrow keys and glides to 50/50 X-Ray Split,
2K Optical Photo or 1:20 CAD Blueprint. The blueprint is drawn through the camera the photograph
was rendered with (the path tracer's shift lens, 4.75 m off the wall), from the render's own
furniture and the planner's own parts, so every line lands on its photographed edge: the ceiling
track and its three 24 deg grazers with their aiming lines, the Linear Pendant 150 on its wires
and feed, the Floating Shelf 110 on its hidden cleat, the Floor Column 140, the travertine console
and the limestone ashlar. Over it sit the 100, 250 and 500 lx contours of the render's light rig,
the 165 cm walkthrough horizon with its sightline ticks, the planner's 24V SELV run from a 150 W
DALI-2 driver node at 1.09% drop, the room's Sabine octaves, a level staff, dimension chains and an
ISO title block. The four capabilities follow as an image-free ledger: pointing at one brings its
callouts forward, choosing one opens the blueprint to them. The drawing engine loads as its own
chunk once the stage comes near. The v9.2.0 media are byte-identical.

## 1. Executive Overview

Lumen is a full-stack configurator for a 24V DC architectural system of light bars, sconces,
acoustic panels and modular shelving, built as one coherent product rather than a set of demos:

- **Editorial commerce**: a 12-part catalog with finishes, photometric curves and quotes in USD,
  EUR and HUF that the server recomputes before it accepts them.
- **3D Room Planner**: one workspace for the whole room. A four-wall WebGL2 room with an orbit
  lens, an elevation lens and a 165 cm walkthrough driven by `WASD`, procedural PBR materials,
  soft-penumbra window gobos in custom GLSL, a solar path, Wavefront `.OBJ` export, and the `1:20`
  ISO 5457 `.SVG` and AutoCAD R12 `.DXF` blueprint of any wall. Visual | Specs lives in its header.
- **Live physics**: 24V SELV driver sizing, daisy-chain routing with hop-by-hop voltage drop,
  DALI-2 dimming, point-by-point illuminance and six-octave Sabine `RT60` with `STI`, recomputed on
  every edit.
- **Lumen AI**: a Model Context Protocol server whose 8 tools read and change the live workspace,
  driven by an LLM tool-use loop or a deterministic orchestrator, streamed over Server-Sent Events.
- **Lumen Cloud**: a Node.js API with no npm dependencies: signed sessions, per-account libraries,
  rate limiting and atomic persistence, mirrored offline by the browser client.

The domain math lives in framework-free modules under `src/lib/` that run unchanged in the
browser, in the server and in the test runner, so a quote, an `RT60` value or a bus voltage drop
comes from the same code everywhere.

## 2. System Architecture

```text
  Browser: React 19 SPA under a strict CSP (script-src 'self', connect-src 'self')
  +--------------------------------------------------------------------------+
  | Client studios                                                           |
  |   RoomPlannerPage   room3d/: WebGL2 studio, GLSL, IBL, OBJ, PNG, DXF     |
  |   HomePage          2K stills, camera films, X-ray photo and blueprint   |
  |   ConciergePanel    Lumen AI chat, applies MCP clientActions as one undo |
  |   Catalog, Bag, Checkout, CommandPalette, AccountPage                    |
  +------------------------------------+-------------------------------------+
                                       | same origin: /api/* JSON and SSE
                                       | src/api/client.js mirrors offline
  +------------------------------------v-------------------------------------+
  | Shared deterministic core: src/lib/ and src/security/ (pure ES modules)  |
  |   electrical  bus-topology  drivers  dimming  lighting-scenes            |
  |   room-physics  illuminance-field  photometry  acoustic-audition         |
  |   quote  logistics  project-diff  scene-codec  blueprint-sheet  dxf      |
  |   mcp-server  mcp-orchestrator         sanitize: zero-trust boundary     |
  +------------------------------------+-------------------------------------+
                                       | imported by the server, never copied
  +------------------------------------v-------------------------------------+
  | Node.js backend: server/ (node: built-ins only)                          |
  |   http-server  production composition, HSTS, graceful drain              |
  |   static       Brotli and gzip, immutable assets, strong ETags, 304      |
  |   app          routes, 64 KB JSON bodies, same-origin guard, headers     |
  |   forwarded    trusted proxy hops: X-Forwarded-For, -Proto and -Host     |
  |   rate-limit   GCRA per client and tier, bounded LRU bucket table        |
  |   session      HMAC-SHA256 Bearer tokens, timingSafeEqual, revocation    |
  |   store        FIFO mutex, fsync and atomic rename, account libraries    |
  |   llm-agent    MCP tool-use loop, SSE stream, deterministic fallback     |
  +------------------------------------+-------------------------------------+
                                       | /data/lumen-cloud.json (Docker volume)

  Production: Internet --HTTPS, HTTP/3--> Caddy (automatic TLS)
              --HTTP + X-Forwarded-*--> app:4173 on the Compose bridge network
```

## 3. Engineering Pillars

### WebGL2, custom GLSL and dual-tier IBL

`src/components/room3d/`, `src/lib/pbr-materials.js`, `src/lib/room-scene.js`, `src/lib/room-walkthrough.js`

- three r187 on WebGL2 through React Three Fiber, shipped in a lazy `RoomCanvas` chunk: a cold
  load of `/` requests no Three.js code; the homepage shows the studio as a photograph in register
  with its own 1:20 blueprint.
- Custom GLSL: a soft-penumbra window gobo shader (an 8% feather at the glass widening to 28% deep
  in the room), additive volumetric beams, and an `onBeforeCompile` analytic specular patch.
- Procedural PBR: 8 materials (walnut, oak, obsidian, steel, felt, chalk, parquet, plaster)
  synthesized on the CPU from seeded value noise into albedo, normal and roughness maps, with zero
  texture downloads.
- Dual-tier IBL: a GPU prefilters a procedural studio environment with PMREM; software rasterizers
  (SwiftShader, llvmpipe) get closed-form analytic speculars and no MSAA, so GPU-less CI runners
  still render the full room.
- Walkthrough: a 165 cm eye, a `WASD` gait of 145 cm/s (215 with Shift) whose ramp is exact per
  frame, so 60, 120 and 240 Hz displays trace the same path; 32 cm wall and 20 cm furniture
  buffers; the camera is written from the frame loop and committed to React once, at rest.

### 2K photography and camera footage

`public/media/`, `src/lib/media-manifest.js`, `src/lib/viewport-video.js`, `src/lib/icons-reel.js`, `src/lib/studio-capabilities.js`, `src/lib/xray-blueprint.js`, `scripts/media/`

- 68 files: two hero scenes (1280 and 2560 w WebP, VP9 WebM and H.264 MP4 films), three 4:5 rooms,
  three Meet our Icons camera films with posters, and 42 catalog finishes, every URL versioned
  with `?v=`.
- Meet our Icons (`src/lib/icons-reel.js`, `useIconsReel`): one rAF clock, running only while the
  banner is on screen under the viewport rule, hands the banner to the next 1920 x 1080 film every
  3 s, round and round; each film starts from its first frame as it fades in and pauses after its
  fade out. The hook writes the DOM directly, so React renders the banner once. Reduced-motion and
  save-data visitors stay on the first poster.
- The films are real footage under the Pexels License (`scripts/media/make-footage.mjs`): each
  source clip is fetched from the Pexels CDN and checked against a pinned SHA-256, cut to 4.5 s,
  scaled to 1920 x 1080 at 29.97 fps with Lanczos, lightly graded in BT.709 and encoded at its own
  rate. Titles, authors and pages are credited in `ICONS_MEDIA`.
- Stills are path-traced (three-gpu-pathtracer) from the planner's parametric CAD parts and
  furniture, rendered as separate light passes (sky, sun, each LED channel), cleaned by a guided
  a-trous filter on albedo-demodulated light and graded through AgX. Light transport is linear, so
  every hero and room film frame is a weighted sum of those passes: seamless 60 fps loops.
- The 3D Spatial Studio X-ray (`src/lib/xray-blueprint.js`) pushes the hero scene
  (`scripts/media/studio/src/scenes/hero.js`) through its own camera into the 2560 x 1440 warm
  still: the visible edges of every part, iso-lux contours from the render's light rig, the
  planner's bus run and the walkthrough horizon, one SVG over the photograph in one frame. Its
  figures (`src/lib/xray-figures.js`) and the ledger's (`src/lib/studio-capabilities.js`) are read
  back against the engines in Node, and the photograph is sampled under the drawing's lines.
- `createViewportVideo`: an `IntersectionObserver` plays a film only on screen in a visible tab,
  pauses it at once off screen, waits for the pointer on hover films and leaves reduced-motion
  visitors on the poster; a film fades in only once it is actually playing.

### 24V DC bus and Sabine RT60 acoustics

`src/lib/electrical.js`, `src/lib/bus-topology.js`, `src/lib/dimming.js`, `src/lib/room-physics.js`, `src/lib/illuminance-field.js`

- 24 V SELV with 60 W and 150 W drivers (6.25 A rated), a 2 x 2.5 mm2 copper loop and a 3% drop
  limit; larger loads become a multi-driver array.
- Manhattan daisy chain: greedy nearest-neighbour routing with orthogonal legs, and a hop-by-hop
  voltage drop in which every hop carries the current of every module downstream of it.
- DALI-2 levels from 10 to 100% per module, carried through power, lux, bus load and the WebGL
  scene, with four circadian lighting scenes.
- Sabine `RT60` in six octave bands (125 Hz to 4 kHz) with ISO 9613-1 air absorption from 1 kHz up,
  `STI` from the 14 IEC 60268-16 modulation frequencies, and a Web Audio audition of the decay.
- Point-by-point illuminance (`E = I(theta) cos(phi) / r^2`) on a 24 x 16 grid, traced into 100,
  250 and 500 lx contours by marching squares; the attic slope masks its cells out.

### Model Context Protocol and the SSE agent

`src/lib/mcp-server.js`, `src/lib/mcp-orchestrator.js`, `server/llm-agent.js`

- A transport-free `handleMcpRequest` (revision `2025-06-18`) with 8 tools, 4 resources and 3
  prompts, every input checked against a strict JSON Schema (`additionalProperties: false`).
- Tools never write storage: a mutation returns `clientActions` that the browser applies as a
  single undo step.
- `POST /api/mcp` takes one JSON-RPC 2.0 message per request; batches and nesting past 12 levels
  answer `-32600`, and a tool fault answers `-32603`, never an HTTP `500`.
- The Lumen AI agent runs the same pipeline as a streaming tool-use loop (Anthropic, OpenAI, Gemini
  or Ollama; 4 rounds of up to 4 calls; 25 s per provider call). Any provider fault falls back to
  the deterministic orchestrator, so every visitor gets an answer.
- `POST /api/concierge/stream` sends `tool_call`, `tool_result`, `delta` and `complete` events with
  `Cache-Control: no-transform` and `X-Accel-Buffering: no`, and is never compressed.

### Red-team security and production HTTP

`server/rate-limit.js`, `server/forwarded.js`, `server/session.js`, `server/store.js`, `server/static.js`, `src/security/sanitize.js`

- GCRA rate limits per client and tier (auth 20, AI 30, write 120, read 600 per minute), at most
  4096 buckets with idle sweep and LRU eviction, and `429` with `Retry-After` before a body is read.
- Proxy trust (`LUMEN_TRUST_PROXY`): `X-Forwarded-For`, `-Proto` and `-Host` are read only from a
  loopback or private peer, right to left, one entry per trusted hop.
- A DNS-rebinding guard ahead of every route: the `Host` header must name loopback, the production
  domains, `DOMAIN` or a host in `LUMEN_ALLOWED_HOSTS`, or the request gets `421 invalid_host`.
- A same-origin guard on every `POST`, `PUT` and `DELETE`. Behind Caddy the expected origin is
  `https://<host>`, so the plain-HTTP twin is refused, and every HTTPS response carries HSTS.
- Sessions are HMAC-SHA256 Bearer tokens compared with `timingSafeEqual`: 12 hours, revocable, never
  cookies, so there is no ambient credential to forge a request with. Placeholder secrets are refused.
- The store serializes writes through a FIFO mutex with a 256-write queue (`503 busy` past it),
  writes with fsync and an atomic rename, and parks an unreadable file instead of overwriting it.
- Static media: `.webp`, `.webm` and `.mp4` with exact types, single byte ranges (`206`, `416`,
  `If-Range`), files over 1 MB streamed from disk, `/media/*` immutable for a year, and the shell's
  CSP as a header too (`img-src 'self' data: blob:`, `media-src 'self' blob:`, `frame-ancestors`).
- Input boundary: 64 KB JSON bodies (`413`, `415`); `safeJsonParse` drops `__proto__`,
  `constructor` and `prototype` at every depth; text loses C0 and C1 controls and bidi overrides;
  `.SVG`, `.DXF` and `.OBJ` exports escape every label.

## 4. Quickstart and Production Deployment

Node.js 22 or newer.

```bash
npm install
npm run dev                  # app and API on http://127.0.0.1:5173
npm run build && npm start   # the build and /api from one process on http://127.0.0.1:8787
npx playwright install chromium
npx playwright test          # builds, serves dist/ with vite preview, runs all 329 tests
```

### Hetzner VPS with Docker Compose and Caddy

1. Point the domain's A (and AAAA) record at the VPS. In the Hetzner Cloud Firewall allow
   `22/tcp`, `80/tcp`, `443/tcp` and `443/udp`; Docker's published ports bypass `ufw`.
2. Install Docker Engine with the Compose plugin from Docker's apt repository
   ([docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)).
3. Clone, configure and start:

```bash
git clone https://github.com/s7codes/lumen.git && cd lumen
cp .env.example .env
sed -i "s/^LUMEN_SESSION_SECRET=.*/LUMEN_SESSION_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d --build
docker compose ps            # app healthy, then caddy running
```

| File | Role |
| --- | --- |
| `Dockerfile` | Node 24 Alpine, two stages: `npm ci` and `vite build`, then a runtime with no `node_modules`, run as `node`, with a `HEALTHCHECK` on `/api/health` |
| `docker-compose.yml` | `app` on the bridge network only (read-only root, no capabilities, `/data` volume, 20 s drain) and `caddy` on `80`, `443` and `443/udp`, started once the app is healthy |
| `Caddyfile` | Automatic HTTPS for `{$DOMAIN:lumen.s7codes.dev}`, a reverse proxy that holds requests through app restarts; SSE is flushed frame by frame |
| `.env.example` | `DOMAIN`, `LUMEN_ALLOWED_HOSTS`, `LUMEN_TRUST_PROXY`, `LUMEN_SESSION_SECRET` and the optional LLM provider keys |

- Update: `git pull && docker compose up -d --build`. The old container drains in-flight requests
  on `SIGTERM`, and Caddy holds new ones for up to 10 s until the new container answers.
- Back up: `docker compose cp app:/data/lumen-cloud.json ./lumen-cloud-$(date +%F).json`.
- Logs: `docker compose logs -f app`, rotated at 3 x 10 MB per service.
- CI builds this image and boots the same stack with `DOMAIN=localhost` on every push to `main`. It
  checks the HTTPS redirect, HSTS, same-origin writes, SSE through Caddy, persistence across a
  container rebuild and a graceful stop.

Every server variable (`HOST`, `PORT`, `LUMEN_DATA_DIR`, `LUMEN_STORE_FILE`, rate limits, LLM
providers) is documented in [server/README.md](server/README.md).

## 5. REST API and MCP Reference

Without a session a request reads and writes the browser-profile library named by `X-Lumen-Client`;
with `Authorization: Bearer <token>` it uses the account library. Errors are
`{ error: { code, message } }`.

| Method | Path | Tier | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | exempt | `{ ok, version, storage }` for load balancers and the container health check |
| `POST` | `/api/auth/session` | auth | Sign in: a signed Bearer token; guest records move into the account |
| `GET` | `/api/auth/session` | read | Verify the presented token |
| `DELETE` | `/api/auth/session` | auth | Revoke the token (`204`) |
| `GET` | `/api/projects` | read | List the library's projects (12 at most) |
| `POST`, `PUT` | `/api/projects` | write | Save a wall or room: `201` new, `200` next revision, `409 quota` past 12 |
| `DELETE` | `/api/projects/:id` | write | Delete one project |
| `GET` | `/api/quotes` | read | List requisitions (24 at most) |
| `POST` | `/api/quotes` | write | Submit a quote; totals rebuilt on the server, `409 stale` on a mismatch |
| `POST` | `/api/sync` | write | Reconcile a device library: projects replace or merge, quotes only merge |
| `POST` | `/api/concierge/ask` | ai | One Lumen AI answer with `toolCalls` and `clientActions` |
| `POST` | `/api/concierge/stream` | ai | The same answer as Server-Sent Events |
| `POST` | `/api/mcp` | ai | Model Context Protocol, one JSON-RPC 2.0 message per request |
| `POST` | `/api/concierge/escalate` | write | Gatekeeper: an `LMN-T-` ticket only for a turn the engine cannot resolve |
| `GET` | `/api/tickets` | read | List engineering tickets (12 at most) |
| `POST` | `/api/test/reset` | write | Clear the caller's library; mounted only with `LUMEN_TEST_RESET=1` |

| MCP tool | Effect |
| --- | --- |
| `inspect_workspace` | Live telemetry for the room, wall or cart: modules, watts, driver, bus drop, `RT60`, `STI`, lux, conflicts |
| `query_catalog` | Search the 12 parts by text, SKU, category, finish, watts, lumens or NRC, priced in USD, EUR or HUF |
| `simulate_physics_and_bus` | Bus topology, six-octave Sabine, illuminance and crate logistics for the live plan or 1 to 12 hypothetical modules |
| `mutate_3d_room` | Mount, remove or clear modules on any wall; set the room preset, furniture, lighting rig, scene or lens |
| `mutate_2d_wall` | Mount, remove or clear modules; recall a scene; resize the wall; toggle slope, snap or surface |
| `manage_cart_bag` | Add or remove parts, clear the cart, or fill it from the live room or wall |
| `lookup_studio_guide` | Answers on navigation, lenses, the gizmo, shortcuts, Visual / Specs mode, saving and CAD exports |
| `unlock_engineering_escalation` | Confirms an inquiry is out of automated scope and unlocks Studio Engineering contact |

| MCP resource | Content |
| --- | --- |
| `lumen://catalog/products` | All 12 parts: dimensions, finishes, watts, lumens, CCT, CRI, NRC, mass, price, lead time |
| `lumen://electrical/drivers-and-bus` | Driver schedule, loop resistance, the 3% drop limit, run lengths and DALI-2 scene levels |
| `lumen://acoustics/sabine-6octave` | Octave absorption coefficients from 125 Hz to 4 kHz, part NRC values, `STI` grades |
| `lumen://workspace/live` | A sanitized snapshot of the caller's 3D room, 2D wall and cart, with computed telemetry |

## License

MIT License, Copyright (c) 2026 s7codes. See [LICENSE](LICENSE).
