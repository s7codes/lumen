# Lumen

[![Playwright E2E](https://github.com/s7codes/lumen/actions/workflows/ci.yml/badge.svg)](https://github.com/s7codes/lumen/actions/workflows/ci.yml)
![Release](https://img.shields.io/badge/release-v7.1.0-e8923a)
![License: MIT](https://img.shields.io/badge/license-MIT-2a2825)

Architectural lighting and modular furniture on a shared 24V DC bus. Lumen is the
platform for browsing the parts, planning a room in 3D, composing a wall in 2D and
ordering the exact bill of materials.

Current release: **v7.1.0**, an architectural-visualisation pass over `/room-3d` and a
calmer studio shell. A room can now carry two or three windows at once: the **Window**
pills in Sun & Aperture toggle West, East and South independently and `None` clears them,
stored as a canonical `windowWalls` list while a single window keeps the exact v7.0
`windowWall` record and share links keep their four-slot `x` tuple. At night the glass no
longer reads as a black rectangle: each window holds a luminous Nordic twilight (`#2d4263`
over a `#1a273b` base, emissive 0.88) and lets a cool moonlit sky into the room as silver
floor patches and faint shafts, framed by a 5 cm plaster reveal, a 15 cm oak sill and
brushed champagne-steel mullions and transom standing 1.5 to 4.5 cm proud of the glass.
Walnut and oak drop their zebra rings for a soft veneer figure under dense micro-fibre
(contrast 0.11 and 0.08), the wide-plank floor calms to a faint ring and a gentle
plank-to-plank tone, and on a GPU a procedural studio environment (an overhead softbox,
east and west strip boxes and a warm horizon bounce) lights timber, steel, ceramic and
glass through `scene.environment` at 0.35; software rasterisers keep the direct rig. The
envelope gains a perimeter ceiling shadow-gap over a crown band and soft depth in every
inside corner, and each floor reference a vignette that never touches its collision
bounds: a woven felt area rug under the bed, sofa and desk, oak bedside ledges with warm
reading lamps, a low oak and slate coffee table with an art book and a ceramic vessel,
throw cushions, layered pillows, a piped mattress and a tucked task chair. The acoustics
key is now **Test Room Echo**: a soft wood clap under a harmonic chord at a lower level,
with a plain readout (`Echo: 1.26 s vs. 1.56 s bare (-19% reverb)`) and a dashed marker
where the bare room's echo would end. The bottom-right pill reads **Ask Lumen**, and
`Ctrl+K` opens a warm basalt spotlight: product names, plain subtitles (`Lighting - 150 x
12 cm`) and price pills in Visual mode, SKUs, paths and wattage in Specs mode, and one
line of keyboard help.

v7.0.0 brought the next-generation WebGL2 engine behind `/room-3d`. Walking
inside the room no longer waits on the keyboard's repeat: a tap of `W A S D`, the arrows
or `Q` / `E` still steps exactly 25 cm or turns 15 deg, and a key held past 150 ms hands
the stance to a per-frame gait that ramps (tau 0.11 s up, 0.09 s down) to 145 cm/s ahead,
120 cm/s sideways and 78 deg/s of turn, 215 cm/s with `Shift`, slides along the floor
reference instead of stopping dead, and commits once where it comes to rest, with zero
React renders in between. Every one of the twelve parts is now drawn as its parametric CAD
sub-assembly (`module.subparts`): the shelf's timber slab on a dark steel cleat with an
aluminium LED channel and two monographs and a ceramic vessel on top, the cube's mitred
2 cm carcass and divider, the sideboard's twin inset doors with a 6 mm reveal and steel
pulls, the frame's nine fluted PET felt slats, the baffle's seven chamfered fins in a wave,
the pendant's louvred beam on twin cables to a ceiling canopy, down to the hub's heat-sink
fins and terminal blocks; the bed gains an upholstered headboard and a layered duvet, the
desk a monitor, sketchbook and task lamp, the sofa plush back cushions, bolster arms and
tapered oak legs. `src/lib/pbr-materials.js` synthesises deterministic, tileable albedo,
bump, normal and roughness maps for walnut and oak grain, brushed anodised and steel
metal, PET felt and limewash chalk, a wide-plank floor and Venetian plaster, in memory with
zero network requests. Lit parts throw translucent volumetric beams (wall-wash fans, spot
cones, the pendant's pyramid, the column's glow, the frame's halo) whose strength follows
each DALI-2 level and the active scene, and every part and the floor reference sit on soft
contact shadows. A **Sun & Aperture** group sets the local solar time from 06:00 to 21:00
(Dawn 07:00, Noon 13:00, Golden Hour 17:30, Dusk 20:00) on a Budapest solar path: the
daylight key light takes the sun's azimuth, elevation and colour temperature (6000K at
noon, 2900K at golden hour, 2200K at dusk), and a mullioned window on the west, east or
south wall lays sunlit pane patches across the floor and shafts of light through the air.
The bed, desk or sofa now backs onto any of the four walls (`Placement`: a wall select,
**Rotate 90 deg** and an offset slider) with its collisions, clearances and walkthrough
footprint turning with it. Specs mode reads the engine telemetry (meshes, CAD sub-parts,
volumetric beams, lights). Rooms that leave the new options at their defaults store, share
and compare byte for byte as before; share links carry them in an optional `x` tuple.

v6.3.0 made Lumen AI an agent. A standards-compliant **Model
Context Protocol** server (JSON-RPC 2.0, revision `2025-06-18`) at `POST /api/mcp`
exposes four resources (the catalog, the 24V bus and drivers, the six-octave acoustics and
the caller's live workspace), three architectural prompts and eight tools, from
`inspect_workspace` and `query_catalog` to `mutate_3d_room`, `mutate_2d_wall` and
`manage_cart_bag`. Tell Lumen AI "Mount a Floating Shelf 110 in Walnut on the East Wall
and set the room to Grand Loft", "Switch to the 165 cm Inside Room walkthrough lens" or
"Add 2 Linear Lightbar 60 in Obsidian to my cart" and it calls the matching tool, shows
the call as an `MCP // mutate_3d_room: ...` chip above the answer, and the live 3D room,
2D wall or cart changes on screen as one step that `Ctrl+Z` undoes. With
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or an Ollama
`LUMEN_LLM_BASE_URL` set, a streaming LLM tool-use loop drives the same tools; without one
(CI, offline, a static host) a deterministic MCP orchestrator plans and runs them through
the identical `tools/call` pipeline, in the browser too. `POST /api/concierge/stream`
streams every answer as Server-Sent Events: `tool_call`, `tool_result`, `delta` and
`complete`.

v6.2.0 made Lumen AI read like a modern assistant. Before the first
message the panel opens on a welcome: the Lumen mark, **How can I help with your
space?**, one line and the four route-aware starters as cards; once the thread starts the
starters fold into one scrolling chip row docked on the composer, so the conversation
keeps at least 80% of the full-height panel, and a **New chat** key in the header clears
it. Questions sit in warm charcoal-bronze bubbles on the right (`#2a2621`, 18 18 4 18
radius); answers sit straight on the glass beside a 22 px Lumen avatar. Every answer is
now one lead sentence and two to four short bullets in `Label: value` form (the panel sets
the label in bold), 35 to 65 words, with at most four metric pills and pill-shaped next
steps; "check my voltage drop" stays on the drop, while "audit my room" reads power,
acoustics, light and layout. The composer is a single pill with a round send key. Both
planners now draw every part as its own miniature architectural SVG
(`ProductThumbGlyph`): a cantilevered shelf with its wash, an open cube, a two-door
credenza, a lightbar, a floor column, a tilted spot, a fluted acoustic frame, the copper
track bus, a twin-cable pendant, a ribbed baffle, a wall sconce and the DALI-2 hub, each
in the active finish's tones and backlit only when it gives light, at 36 px on the
Components and Asset Shelf palettes and 28 px in the module lists and the `Ctrl+K`
palette. The overview no longer drops to flat black below the hero: one continuous
atmosphere scrolls with the sections (tungsten and bronze washes, drafting lines,
champagne hairline dividers), and every other route sits on a fixed backdrop of warm
basalt depth (`#0d0c0b` to `#141210` to `#0b0a09`), a tungsten wash from above and drafting
lines at the edges; the Account tiles are lit from their top edge. CI gives the long
software-WebGL scenario tests a 60 s budget on its shared four-vCPU runner.

v6.1.0 taught Lumen AI how the site itself works. Plain questions such as "Why cant I open 3D
room designer", "how do I move furniture in 3D", "how do I walk around inside the room"
or "what is Visual vs Specs mode" get a resolved, accurate walkthrough of the navbar, both
planners, their lenses, gizmo, room presets, keyboard shortcuts and fault checks, with
direct keys such as **Launch 3D Spatial Studio** (`/room-3d`) and **Launch 165 cm
Walkthrough** (`/room-3d?lens=inside`). Contractions with or without the apostrophe,
typos and the many names visitors give the planners are folded before matching, and
greetings or "what is Lumen" get a short tour of the platform. Transport never fails the
conversation: whenever `POST /api/concierge/ask` cannot answer (unreachable, a 404 from a
dev server started on an older checkout, a 5xx or an unreadable reply), the same
deterministic engine answers on the device with the same reply id. In development the API
itself loads through Vite's SSR module graph, so an edit under `server/` or `src/lib/`
takes effect on the next request without restarting the dev server.

v6.1.0 also redrew the panel as stealth basalt glass: the Lumen mark on a dark pill, a
**Lumen AI** header with a **Workspace Aware** badge, answers that stream in once, compact
metric pills, a champagne primary next step and an understated **Did not resolve my
issue - request engineer** link. Confidence and sources are Specs-mode detail. The
gatekeeper is silent while locked: its status is spoken to assistive technology and never
painted, and it surfaces only once contact unlocks. The navbar **Cart** pill gained a bag
glyph that pairs with **Search**, and the showcase's launch box became one launch bar
under the theatre and its cards (headline, three quick-launch pills and the champagne
key, 96 px tall on a desktop) whose keys stay anchored on hover: no lift, no plinth, no
magnetic drift; the cap brightens and only the arrow travels 3 px.

v6.0.0 added the **Lumen Studio AI Concierge**, bottom-right on every
route. The **Ask Studio AI** pill opens a spec concierge that answers from the 12-part
catalog, the 24V SELV driver schedule and voltage-drop model, DALI-2 dimming and scenes,
Sabine acoustics and illuminance, both planners, the CAD exports, pricing, VAT,
fulfilment and Lumen Cloud, and that reads the visitor's live 2D wall, 3D room and cart
through the same engines the planners and checkout use: modules per wall, rated and
active 24V load, the sized driver, bus run and voltage drop, RT60, STI, lux, conflicts,
crates and dispatch waves. One deterministic engine (`src/lib/concierge-engine.js`)
answers on the server through `POST /api/concierge/ask` and on the device when the API
is unreachable, with the same reply id either way. Human contact sits behind a strict
gatekeeper: **Contact Studio Engineering** unlocks only when the engine cannot resolve an
inquiry (confidence under 0.45) or the visitor marks a resolved answer **Did not resolve my
issue**. Asking for a human, by itself, never unlocks it. `POST /api/concierge/escalate`
replays every transcript turn through the engine before it issues an `LMN-T-XXXXXXXX`
ticket, so a request without a verified unresolved or unhelpful turn answers
`400 gatekeeper_locked`. Tickets are listed under **Studio Engineering Tickets** on
`/account`. CI now runs the suite on four parallel workers with a cached Playwright
browser and uploads the HTML report only when a run fails.

v5.3.0 put the navbar in page order, **Overview**, **3D Room**,
**Catalog**, **Wall Studio**, and the overview scrolls the same way: hero, spec strip and
Surface & Dimming Lab, then the 3D Spatial Studio (`#spatial-studio-3d`), Core Modules
(`#core-modules`) and Workspaces (`#workspaces`). The scroll-spy holds the last section
whose head has crossed a reading line 45 percent down the viewport, so the underline steps
one tab at a time, left to right going down and right to left coming back, and never
flashes back across the gaps between sections. **Catalog** and **Wall Studio** read as the
location over their preview sections and still route straight to `/catalog` and
`/studio-2d`. The showcase turntable is calm: a 20 deg/s orbit, a 27 to 35 deg pitch
swell, 64 cm/s bus pulses and 7 s acts, on a stage that grows into the card column. The
three capability cards carry an index, a glyph badge, one short sentence and two spec
pills. **Launch 3D Spatial Studio** wears a champagne cap (`#f3e3c6` to `#d8b27c`,
espresso ink) with an alabaster beam tracing its edge every 6 s. `/studio-2d` sits in a
warm drafting-room backdrop: a key light pooled over the elevation, a ground line, a
perspective plinth and a registered sheet frame. Both planners can **Audition RT60**: the
room's six-band decay plays through Web Audio while a dB decay curve sweeps in real time.
`/room-3d` adds **Capture .PNG**, a 1600 x 1000 studio render card of the room with its
specification.

v5.2.0 made the navbar underline follow the overview: **Overview**
is current above the 3D Spatial Studio, **3D Room** takes over (`aria-current="location"`)
while the section crosses the reading band 40 to 45 percent down the viewport, and a
navbar glide holds it for the whole flight. The showcase stage is a live canvas 2D
theatre: a projected 640 x 520 x 300 cm Gallery with four section-cut walls, a linear
pendant, lit shelf, corner column, acoustic frame and platform on one 24V bus, cycling
four 4.5 s acts (360-degree orbit with bus pulses, a 78 deg lens at 165 cm with live
eye lux, a raycast gizmo sliding the shelf on 5 cm ticks with laser dimensions, and an
iso-lux field with 100 / 250 / 500 lx rings). Act keys and the capability cards hold or
preview an act, and the cursor parallaxes the camera and probes floor lux, all outside
React. The bottom bar is now the **3D Studio Launchpad**: an amber-lit portal with the
flagship **Launch 3D Spatial Studio** key and three quick-launch presets that open
`/room-3d?lens=orbit`, `/room-3d?lens=inside` and `/room-3d?scale=loft&lens=inside`.

v5.1.0 unlocked the orbit: the camera turns a full 360 deg round all four walls
with no stop (yaw wraps through +-180) and climbs from 5 deg above the floor to an 85 deg
plan view, zoom 0.45x to 2.4x. Rooms grow to 900 x 900 x 420 cm, and four **Room scale**
pills in the Envelope card set Compact (320 x 280 x 250), Living (480 x 420 x 270),
Gallery (640 x 520 x 300) or Grand Loft (800 x 650 x 340) in one undoable press. Inside
Room (165 cm) is now a 78 deg architectural lens with +-65 deg of look pitch; the wheel or
the `+` / `-` keys swing it from 50 to 92 deg, and the observer opens backed up to 78
percent of the way from the wall in view, carried to the same relative spot when the
envelope changes. The navbar reads Overview, Catalog, Wall Studio, 3D Room: **3D Room**
glides to the new **3D Spatial Studio** showcase on the overview (three capability
pillars and **Launch 3D Spatial Studio**, still zero WebGL on `/`), and the launch key enters the planner under a full-screen engine boot that lifts
with a defocus while the workstation settles in. Wall Studio is calmer in Visual mode: a
gallery wall with a faint grid, an **Open in 3D Studio** key and a quiet engineering strip.

`/room-3d` is a full-viewport spatial workstation (v5.0.0). A
header bar carries the title and envelope, the four wall tabs, the camera lens, **Grid
Snap** and a **Zen** key; a 260px left dock holds the envelope, lighting and asset shelf,
a 288px right dock the wall-grouped outliner and inspector, the stage takes 72vh between
them and the KPI and CAD bridge strip sits in a bottom dock. Each dock scrolls on its own;
Zen folds both away so the viewport spans the full width. The page opens on the **Lumen
Spatial Engine** boot: monogram, progress bar and three subsystem steps on a full-screen
basalt plate, clearing 950 ms after the canvas is ready, at once under reduced motion or
on **Enter Studio Now**; the layer never takes the pointer, and **Replay Engine Boot**
plays it again.

Three camera lenses. **Orbit Cutaway** is the v4 orbit with its section cut. **Inside
Room (165 cm)** stands the eye inside the room, backed up toward the wall opposite the
one in view: all four walls, the 8 cm baseboards, the corner creases and a ceiling stay in
view, a drag turns the head through 360 deg (pitch -65 to +65 deg), the wall tabs swing
the gaze to 0, 90, 180 or -90 deg, and `W A S D`, the arrows, `Q` / `E` or the walk pad
step 25 cm and turn 15 deg, held 32 cm off the walls and clear of the floor reference.
**Wall Elevation** looks dead-on and level at the middle of the active wall. A compass in
the stage corner turns with the view, reads the azimuth and faces a wall (`N E S W`), the
corner orbit (`ISO`) or the eye (`EYE`) in one press.

Modules move on their walls in 3D. `src/lib/room-raycast.js` exports
`intersectRayWithWall(origin, dir, wall, room)`, the hit of a room ray on the interior
plane of the north (Z 0), east (X = W), south (Z = D) or west (X 0) wall in that wall's
own `(uCm, vCm)`, and `solveWallDragPosition(...)`, which takes off the grab offset,
applies an axis lock (`free`, `x`, `y`), snaps to 5 cm (1 cm with Grid Snap off) and
clamps to the wall. The selected module carries a transform gizmo (X along the wall, Y up
it, an XY plane square) and laser dimensions to the floor, both corners and the ceiling.
Dragging the module or a handle casts one ray per animation frame and writes the mesh,
gizmo, dimensions and scene-graph mirror straight to the DOM; React hears one commit on
release, a single undo step. `G` grabs from the keyboard (arrows step, Enter confirms,
Escape restores), and the inspector's Transform section adds an Axis Gizmo Lock and a
nudge pad. A **Skip to main content** link now leads every page.

v4.2.0 put a freight manifest on every quote. Each catalog part
states its mass (`weightKg`, 1.4 to 18.5 kg; 0.6 kg for the 60W driver, 1.2 kg for the
150W unit), read out as **Mass / Weight** on its spec sheet. `src/lib/logistics.js`
exports `computeLogisticsSchedule(bagLines, electrical, { fulfilmentMode })`, a pure
manifest attached to `buildQuote` as `quote.logistics`: net mass, tare (18% of net, 0.8
kg minimum), gross, crated volume in m3, crates and dispatch waves. Parts with a span of
120 cm or more pack into a **Long-Span Timber Tube**, shelves, cubes, sideboards and
frames into a **Reinforced Millwork Crate**, and spots, sconces, lightbars, hubs and
drivers into a **Precision Hardware Carton**, first-fit by mass (25, 45 and 15 kg caps)
and numbered `CRT-01` onward. Freight is **Parcel Courier** under 35 kg with no crate
over 160 cm, **Dedicated Van / LTL** under 65 kg and **ISPM-15 Euro-Pallet Freight** from
65 kg. **Consolidated Dispatch** ships everything in one wave at the longest lead time.
**Split Rough-In Dispatch** sends the driver and every part on two weeks or less in Wave
01, so the 24V trunk and driver go in during rough-in, and fabricated parts in Wave 02.
Mass is summed in tenths of a kilogram, so net + tare === gross exactly. Quote totals are
untouched, so the server's `grossMinor` cross-check is unchanged.

v4.1.0 set two versions of a design side by side.
`src/lib/project-diff.js` exports `compareProjectStates(base, target)`, a pure comparison
of two walls or rooms, cloud records or live states, rebuilt through the planner
sanitizers. It returns eight deltas, each `{ base, target, delta }`: `modules`, `loadW`,
`activeW`, `fluxLm`, `priceUsd`, `luxAvg`, `rt60Sec` (negative is added damping) and
`stiScore`, read from the same summary and Sabine engines as the planners. Modules pair
by `uid` while it still names the same part, then by part and wall, nearest first. Each
pair is unchanged or modified (`Moved +25 cm X / Finish Walnut to Oak / Dimmed 100% to
60%`, `Rehung North Wall to East Wall`); the rest are added or removed. **Compare
Changes** beside the project name in both planners opens the **Project comparison**
dialog: the live draft (B) against the cloud revision of the open project (A), or a clean
default envelope when it was never saved. On `/account`, **Compare** on any card, or
**Compare Projects** once two are saved, opens the same dialog with Baseline (A) and
Target (B) selects over every saved project and both live drafts, a swap key, two
elevations with added, modified and removed modules outlined, six delta tiles and an
itemized change log.

v4.1.0 also settled three planner details. Number wells drop the native spin keys app
wide (`appearance: none`, `textfield` in Firefox), and the Dimensions forms in both
planners become label-left rows with an 88px right-aligned tabular well, so `300`, `280`
and `250` keep 12px of padding clear. **Save to Cloud** centres its glyph and label as one
unit 8px apart and shares a 38px height and an equal half of the row with **Sync Wall to
Cart** / **Sync Room to Cart**. Switch labels such as `Attic slope` hold one line, and
palette size and power each hold together, so a unit never breaks from its figure.

v4.0.0 made the 3D Room Planner a four-wall, 360-degree room.
Each module carries a `wall` (`north`, `east`, `south` or `west`) and keeps its
own elevation frame: `Left X` along that wall, `Bottom Y` up from the floor. North and
south span the room width, east and west its depth. A **Wall Selector** above the stage
(`North Wall`, `East Wall`, `South Wall`, `West Wall`, each with a module count)
picks the active wall: new parts mount on it, the camera glides round to face it, and
the 2D bridge loads and pushes that wall alone. The inspector shows the wall a module
hangs on and rehangs it on another through **Mounted on**, at the clear spot nearest its
position, with the view following. Collisions run wall by wall plus a true 3D test for
modules meeting in a corner and against the floor reference. `src/lib/room-walls.js`
holds the frames: `rotY` 0, -90, 180 and +90 deg, carried through the WebGL meshes,
emitters, spot and point light targets, the floor lux field and the `.OBJ` export. The
24V run unrolls the four walls into one elevation. A missing `wall` reads as north, and
north is never written, so every stored room, cloud project, preset and `?scene=` link
from before loads and encodes exactly as it did.

v4.0.0 also made the planners easier on the eye and on newcomers. The navbar reads in
the sans face at 13.5px in Title Case, without numeric prefixes; the search pill shows
only its glyph and `Search` (`Ctrl+K` / `Cmd+K` still opens the palette); the mode
switch reads **Visual** and **Specs** instead of Arch and Tech. The 3D stage sits on a
warm horizon gradient behind a transparent canvas; the night rig lifts its fill and gives
walls and floor an emissive floor tone (`#262320`, `#1c1a17`) with a perimeter trim, so
the room is legible with no channel lit. The 2D wall (`#1e1c19`, a 1.5px `#38342e` edge
ring, a hatched floor datum) stands off its `#11100f` surround, and modules gain an
inner bezel and a hover name tag. Sidebars become soft cards with plain headings and
palette rows that read `110 x 8 cm, 18 W`; toolbars group into Edit, Scenes and
Engineering clusters; the summary leads with Modules, 24V Load, Luminous Flux and Total
Price above an Engineering Telemetry (and, in 3D, CAD Bridge) sub-grid. The code is MIT
licensed to s7codes.

v3.5.0 gave every powered module a DALI-2 arc level, `dimPct`
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
| v7.1.0  | ArchViz polish and calmer shell: two or three windows at once (West, East, South toggle pills, canonical `windowWalls`, v7.0 single-window records and links unchanged); luminous Nordic twilight glazing with moonlit floor patches and shafts at night; plaster reveal, deep oak sill and brushed steel mullions proud of the glass; zebra-free walnut and oak veneer and a calm wide-plank floor; procedural studio IBL environment on GPUs; ceiling shadow-gap cove and corner depth; woven area rugs, bedside ledges and lamps, coffee table, throw cushions and a task chair as drawn-only furniture vignettes; Test Room Echo with a soft wood clap and a bare-versus-damped readout; Ask Lumen pill; warm basalt Ctrl+K spotlight with Visual-mode names, subtitles and price pills |
| v7.0.0  | Next-generation WebGL2 room engine: continuous 60 to 240 Hz walking with exact taps, ramped holds, Shift stride and one commit on release; multi-part parametric CAD sub-assemblies for all 12 parts and detailed reference furniture; procedural tileable PBR albedo, bump, normal and roughness maps for eight material families; volumetric light beams that follow DALI-2 levels and contact shadows; Sun & Aperture solar path with golden hour, window pane patches and light shafts; floor reference on any wall with offset; engine telemetry in Specs mode |
| v6.3.0  | Lumen AI as an MCP agent: JSON-RPC 2.0 Model Context Protocol server at `POST /api/mcp` (revision 2025-06-18) with 4 resources, 3 prompts and 8 tools including live 3D room, 2D wall and cart mutation; multi-provider LLM tool-use loop (Claude Messages API, OpenAI-compatible, Gemini, Ollama) with a deterministic MCP orchestrator as the key-free path; Server-Sent Events at `POST /api/concierge/stream`; agentic workspace bus that applies tool results live as one undoable step; MCP tool trace chips in the panel |
| v6.2.0  | Modern Lumen AI chat: welcome hero with starter cards that fold into a docked chip row, New chat, right-aligned warm question bubbles, avatar answers and a pill composer; every answer one lead sentence and two to four labelled bullets (35 to 65 words, at most four pills); bespoke 36 px / 28 px architectural SVG drawings of all 12 parts in both planners' palettes, module lists and Ctrl+K; a continuous lit atmosphere below the overview hero, a fixed route-aware basalt backdrop on every other route and lit Account tiles; 60 s CI budget for software-WebGL scenario tests |
| v6.1.0  | Lumen AI understands the site itself: navigation, both planners, lenses, gizmo, room presets, modes, shortcuts and fault checks, with direct launch keys; phrasing normalisation; a local answer on any API fault (404, 5xx, unreachable, unreadable); dev API hot-reloaded through Vite's SSR module graph; stealth basalt panel with a silent locked gatekeeper; navbar Cart glyph; slim showcase launch bar with anchored keys |
| v6.0.0  | Lumen Studio AI Concierge on every route with live-workspace retrieval over the catalog, 24V bus, DALI-2, acoustics, planners, CAD exports, pricing and fulfilment; strict support escalation gatekeeper with server-replayed transcripts; `POST /api/concierge/ask`, `POST /api/concierge/escalate`, `GET /api/tickets`; Studio Engineering Tickets on `/account` with an offline outbox; four-worker CI with a cached Playwright browser |
| v5.3.0  | Navbar and overview in one left-to-right order with a sequential scroll-spy; calm 20 deg/s turntable with 7 s acts; lighter capability cards with spec pills; champagne launch key with a perimeter beam; drafting-room Wall Studio backdrop; Web Audio RT60 audition in both planners; 1600 x 1000 `.png` studio render card |
| v5.2.0  | Scroll-spy navbar underline on the overview; canvas 2D showcase theatre with four autonomous acts, act keys, card previews, cursor parallax and a lux probe; 3D Studio Launchpad with `?lens=` and `?scale=` quick-launch presets |
| v5.1.0  | Unrestricted 360-degree orbit and 85-degree plan pitch; 900 x 900 cm envelopes and four room scale presets; 78-degree inside lens with wheel FOV and a backed-up stance; navbar swap and overview 3D Spatial Studio showcase; full-screen engine boot with a defocus reveal; calm Visual-mode Wall Studio |
| v5.0.0  | Full-viewport 3D spatial workstation with engine boot and zen viewport; orbit, inside-room 165 cm and wall elevation lenses; ray to wall-plane drag engine, transform gizmo, laser dimensions, compass, wall-grouped outliner; skip link |
| v4.2.0  | Part and driver mass, crate packing and freight class engine, consolidated or split rough-in dispatch waves on checkout |
| v4.1.0  | Project and revision A/B diff engine and comparison dialog; spin-free number wells, centred cloud save key, one-line sidebar labels |
| v4.0.0  | Four-wall 360-degree room with wall selector and per-wall mounting, collisions, bridge, lux and OBJ; human-friendly planner UI; Visual / Specs switch |
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
vite.config.js          build config, dev-only CSP relaxation for HMR, hot-reloaded dev API
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
                        SpatialShowcase (overview 3D studio section),
                        EnvironmentalPhysicsCell, ElevationThumb,
                        ProductThumbGlyph (architectural drawing per part),
                        ProjectDiffModal (lazy on /account),
                        RouteFallback (loading frame and chunk error), icons
    studio/             WallStage, StudioPalette, StudioInspector, StudioToolbar,
                        BlueprintSheetModal,
                        StudioSummary, shared field, switch and finish controls
    room3d/             RoomViewport, RoomCanvas (lazy WebGL), RoomControls,
                        RoomInspector, RoomToolbar, RoomSummary, CameraSettings,
                        StudioBootOverlay (full-screen engine boot)
  contexts/             AuthContext (session, RequireAuth), ToastContext
  data/                 products.js (parts, finishes, categories), wall-presets.js
  pages/                Home, Catalog, ProductDetail, Checkout, RoomPlanner,
                        WallStudio, Account, NotFound
  hooks/                useAmbientLight, useBag, useCardTilt, useCloudSave,
                        useCommandPalette, useCurrency, useDisplayMode,
                        useDocumentTitle, useDraftDiff, useLaunchedModule, useLaunchPreset,
                        useMagneticField, useModalDialog, useProjectName, useSceneShare,
                        useRoom3d, useScrollReveal, useSectionLink (glide and
                        scroll-spy), useShowcaseTheatre, useWallDrag, useWallStudio
  lib/                  MCP server: JSON-RPC 2.0, resources, prompts and tools
                        (mcp-server), deterministic MCP orchestrator
                        (mcp-orchestrator), agentic command parser (agent-intent),
                        workspace execution bus (workspace-bus, workspace-events),
                        bag store and PSU sizing, wall studio geometry and history,
                        room model and 2D bridge (room-3d), WebGL scene description,
                        CAD sub-assemblies, volumetric beams and orbit frame
                        (room-scene), procedural PBR map synthesizer and studio
                        IBL environment (pbr-materials), solar path and window
                        walls (solar-path), ray to
                        wall-plane drag solver (room-raycast), camera lenses, the
                        165 cm observer and its continuous gait (room-walkthrough),
                        guarded per-frame DOM writes
                        (dom-writes), Wavefront OBJ writer
                        (obj-export), 1:20 blueprint sheet compiler and SVG
                        (blueprint-sheet), AutoCAD R12 DXF writer (dxf-export),
                        named project ids (project-library), A/B project
                        comparison (project-diff) and its dialog sources
                        (diff-sources), palette
                        index and ranking (command-index), room echo test: wood
                        clap, decay curve and readout (acoustic-audition), studio render card
                        compositor (render-snapshot), credentials and session
                        token rules (auth), cloud record rules shared with the
                        server (cloud-records),
                        closed-form spring, display mode and currency stores,
                        photometry and intensity model, 24V bus electrical model,
                        daisy-chain routing and drop (bus-topology), illuminance
                        and Sabine RT60 (room-physics), point-by-point lux
                        field and iso-lux contours (illuminance-field), share link
                        codec (scene-codec), quick-launch links (launch-presets),
                        showcase theatre scene, photometry and choreography
                        (showcase-scene) and its canvas painter (showcase-painter),
                        clipboard with fallback,
                        quote engine, crate packing and dispatch waves
                        (logistics), boxed driver specs (drivers), formatting, nav routes, lazy chunk loaders
                        and prefetch (route-manifest)
  security/sanitize.js  safeJsonParse, safeStorage, input validators
  styles/               tokens, base, animations, shell, toast, home, pages, product,
                        product-detail, checkout, studio, room3d, account, cloud,
                        command-palette, empty-state, project-diff, elevation-thumb
server/                 Lumen Cloud HTTP API, shared with Vite dev and preview
  app.js                request handler: routes, 64 KB JSON bodies, sessions, headers,
                        POST /api/mcp and the SSE concierge stream
  llm-agent.js          Lumen AI: .env loading, provider choice, streaming LLM
                        tool-use loop over the MCP tools, deterministic fallback
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
| `/`          | Overview      | Pendant hero, surface and dimming lab, 3D Spatial Studio theatre and launch bar (`#spatial-studio-3d`), core modules (`#core-modules`), workspaces (`#workspaces`) |
| `/catalog`   | Catalog       | Category, search and sort over 12 parts, finish swatch    |
| `/catalog/:id` | Spec sheet  | Orthographic set, exploded assembly, photometry or bus curve, launchers |
| `/checkout`  | Project Quote | BOM, driver, freight, currency, trade code, print, export, submit |
| `/room-3d`   | Room Planner  | Lazy chunk. WebGL room, clearances, 2D bridge, `.obj` and `.png` export, cloud save, cart sync; `?lens=` and `?scale=` quick launch |
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
| `GET /api/health` | | `{ ok: true, version: '7.1.0', storage: 'server' }` |
| `POST /api/auth/session` | `{ email, password }` | `201 { token, expiresAt, user: { name: 'Studio Guest', email }, library: { scope: 'account', claimed: { projects, quotes } } }` |
| `GET /api/auth/session` | `Authorization: Bearer` | `200 { user, expiresAt }` or `401` |
| `DELETE /api/auth/session` | `Authorization: Bearer` | `204`, revokes the token |
| `GET /api/projects` | | `{ projects }`, newest first, at most 12 |
| `POST` or `PUT /api/projects` | `{ kind, name, data }` | `201` new or `200` revised: `{ project, projects }` |
| `DELETE /api/projects/:id` | | `{ projects }`, idempotent |
| `GET /api/quotes` | | `{ quotes }`, newest first, at most 24 |
| `POST /api/quotes` | `{ quote: { items, currency, promo, includeDriver, grossMinor }, project }` | `201 { quote, quotes }` |
| `POST /api/sync` | `{ mode, projects?, quotes? }` | `{ projects, quotes }` |
| `POST /api/concierge/ask` | `{ question, workspaceContext? }` | `200 { reply: { id, question, answer, confidence, category, resolved, citations, suggestedActions, metrics, toolCalls, clientActions, mcpProtocol } }` |
| `POST /api/concierge/stream` | `{ question, workspaceContext? }` | `200 text/event-stream`: `tool_call { name, arguments }`, `tool_result { name, summary, clientActions, isError }`, `delta { text }`, then `complete { reply }`; validation faults are JSON `400` before the stream opens |
| `POST /api/mcp` | one JSON-RPC 2.0 message; workspace in `params._meta["lumen/workspace"]` | `200` JSON-RPC response, `202` for a notification, `400` with `-32700` or `-32600` for input it cannot accept, `403` for a cross-origin browser call |
| `POST /api/concierge/escalate` | `{ email, subject, message, reason, transcript, workspaceSummary }` | `201 { ticket, tickets }`, or `400 gatekeeper_locked` without a verified unresolved or unhelpful turn |
| `GET /api/tickets` | | `{ tickets }`, newest first, at most 12 |
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
- Errors are JSON `{ error: { code, message } }`: `400 invalid`, `400 gatekeeper_locked`, `401 unauthorized`,
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
| `askConcierge(question, workspaceContext)` | `{ reply, transport }`, `transport` is `http` or `local` | none |
| `submitSupportTicket(payload)` | `{ ticket, transport }`; offline, the ticket waits in an outbox | `lumen_cloud_ticket_outbox_v1` |
| `loadSupportTickets()` | tickets, newest first, at most 12; queued device tickets carry `pending: true` | `lumen_cloud_tickets_v1` |

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
  of clicks commits one revision. The glyph and the active label travel as one centred
  unit 8px apart; the key takes its width from its row, an equal half beside the cart
  key at the same 38px height, so it never changes width between states.
- **Compare Changes** shares the project row with the name well. It opens the
  **Project comparison** dialog on the live draft against the cloud revision saved under
  the current name (else the last revision this session saved, else a clean default
  envelope), with the cloud library fetched behind a hairline sweep.
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
  chunk, which the room viewport loads on demand. The overview hero is CSS only and the
  3D Spatial Studio theatre draws on a canvas 2D context, so the home page never touches
  WebGL.
- Intent prefetch. `src/lib/route-manifest.js` holds the lazy loaders and exports
  `prefetchRoute(path)` (re-exported from `router.jsx`). The **3D Room** and **Wall
  Studio** navbar links, the showcase's **Launch 3D Spatial Studio** key and Wall Studio's
  **Open in 3D Studio** key call it on pointer enter and on focus, and the command palette
  calls it when a workspace is highlighted, so the chunk is cached before the click. The
  **3D Room** link itself opens the overview showcase, which is canvas 2D, never WebGL. The
  room planner also warms its WebGL chunk behind the page. Each path is fetched once per
  session, and nothing is prefetched when the browser reports Save-Data or a 2G link.
  A cold load of `/` still requests zero planner or WebGL chunks.
- The Studio AI panel and its engine ship as their own chunks (`ConciergePanel`,
  `concierge-engine`), loaded on pointer or focus intent over the **Ask Lumen** pill.
  The client only imports the engine dynamically, for the offline fallback.
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
anodized aluminum neutrals. The navbar, planner sidebars and toolbars read in the sans
face in Title Case (13-13.5px); monospace is kept for dimensions, coordinates and
engineering readouts. Planner sidebars stack soft cards (`--card-surface`,
`--card-edge`, 12px radius) and toolbars group keys into pill clusters (`--cluster-*`). `--section-space` is 160px at 1280 wide and 200px from 1600, and
headlines run 640 weight against 350 weight ledes. From 1920px `--grid-max` widens to
1600px and the root type steps to 17px (18px and 1760px from 2400px), so copy holds on
2K displays. The 12-column structural grid sits behind the shell at 1% and fades out
down the viewport. Technical mode tints it amber, keeps it full height and reveals
measurement overlays; the choice persists through validated storage.

No page sits on flat black. `LayoutShell` renders one fixed `.ambient-backdrop`
(`data-atmosphere` names the route) under the structural grid: warm basalt depth
(`#0d0c0b` to `#141210` to `#0b0a09`), a tungsten wash falling on the stage from above, an
oak glow from the top right, a bronze lift from the lower left and a 96 px drafting
lattice that clears toward the middle of the page. On the overview the hero owns the top
and the backdrop stays a calm basalt; below the hero `.home-atmosphere` scrolls with the
sections, rising from the hero's floor tone (`rgb(10, 10, 9)`) into warm basalt with
tungsten and bronze washes behind the lab, the 3D studio, the core modules and the
workspaces, 120 px drafting lines that strengthen toward the edges, and a champagne
hairline (`rgba(229, 199, 153, 0.16)`) at the head of each section.

Every part has its own drawing (`ProductThumbGlyph`): a miniature architectural SVG on
a dark glass tile, 36 px in the planner palettes and 28 px in the module lists and the
command palette, painted in the base, highlight and shade of the active finish
(`FINISH_RAMPS`). Parts that give light carry a warm backlight and their light cones while
their 24V channel is on; passive hardware never glows.

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
The display mode switch is two pill segments inside a glass track, **Visual** and
**Specs** (stored as `architectural` / `technical`), and the engaged one inverts to
solid white. Buttons, switches and badges never glow: light belongs only to
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
  Nothing glows: the plinth has no blur, and the glow guard in the E2E suite holds. A key
  opts out with `data-magnet="off"`: the overview's **Launch 3D Spatial Studio** key stays
  anchored (no lift, no plinth, no pull), brightens its champagne cap in place and slides
  only its arrow 3px, with the perimeter beam still running.
- Showcase theatre: `useShowcaseTheatre` runs one rAF loop per overview visit, only while
  the stage is on screen. It is paced as an architectural turntable (`showcase-scene.js`):
  7 s acts (`ACT_SECONDS`, `ACT_DURATION_MS`), a 20 deg/s orbit (`ORBIT_DEG_PER_S`), a
  27 to 35 deg pitch swell (`ORBIT_PITCH`), 64 cm/s bus pulses and a gizmo choreography
  laid out as fractions of the act. The projection is framed for 3:2, so a stage stretched
  beside the taller card column gains headroom instead of zooming in. Every motion
  integrates the frame dt: the camera rides the closed-form spring (`k = 14`, `c = 7.6`)
  toward each act, act presences and the light
  level approach exponentially, the gizmo shelf glides onto each 5 cm tick, and the
  pointer parallax (up to 9 deg yaw, 6 deg pitch) has its own spring, so the same curves
  play at 60, 120 and 240 Hz. The loop paints the canvas and writes AZ, PITCH, LUX, the
  act readout and the act-key fill straight into the DOM; React hears only act changes.
  Under reduced motion each act is one still frame and the cycle does not run.
- Launch key beam: `cta-border-beam` is an SVG overlay on **Launch 3D Spatial Studio**
  with two rects at `pathLength="100"`, a gold trail and an alabaster head that share a
  leading edge. Their dash offsets run 100 units every 6 s (`linear`, `infinite`), so the
  ribbon moves at one even speed round the long and short edges of the key. It is a
  stroke, never a blurred shadow, and it pauses under reduced motion.
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
- The navbar **Cart (n)** pill opens the cart drawer. It carries a 14 px bag glyph on the
  same 16-unit grid and 1.25 stroke as the **Search** glyph, so the two keys read as a
  pair; below 420 px it folds to the glyph and count while its accessible name stays
  **Cart (n)**. Every visible label says cart:
  **Add to Cart**, **Clear cart**, **Sync Wall to Cart**, **Sync Room to Cart** and the toasts.
  Internally the store, hook, CSS classes, test ids and storage key keep the `bag` name.
- The cart is stored under `lumen_bag_v1` through `safeStorage`. Every read is rebuilt line
  by line: unknown products, finishes a part does not ship in and quantities outside
  1-99 are dropped, duplicates merge, and the cleaned value is written back. Other tabs
  follow through the `storage` event and pass through the same validation.
- Driver sizing: up to 60W on one 60W driver, up to 150W on one 150W driver, above that
  a multi-bus array of 150W drivers.

## Wall Studio

- The stage is a drafting room (`wall-stage`): the viewport keeps its `#11100f` surround
  under a warm key light (`radial-gradient(ellipse 85% 70% at 50% 38%, ...)`), the floor
  datum runs out across the studio as a fading ground line, and a plinth floor recedes in
  one-point perspective under the elevation with the key light pooled on it. A hairline
  sheet frame (`studio-backdrop`) carries registration crosses in the corners and a tick
  at each edge centre. Every backdrop layer ignores the pointer and is clipped to the
  viewport, so drag, marquee and page width are untouched.
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
- Visual mode keeps the wall a calm gallery elevation: the 10 cm graph paper fades out,
  the 50 cm grid drops to a whisper, minor ruler ticks and ruler numbers recede. Specs
  mode, or any module in hand, brings the full grid and the numbered rulers back on a
  420 ms fade (the grid colours are registered custom properties). The toolbar's main row
  holds Edit, the DALI-2 scenes and **Open in 3D Studio** (`studio-open-3d`); 24V Bus,
  Iso-Lux Map, Blueprint, Share Link, Export JSON and Import JSON sit in a quiet 24 px
  strip beneath it with the status line. Engineering Telemetry stays mounted and visible,
  set as a compact mono footnote in Visual mode.
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

- Rooms run 240-900 cm wide, 200-900 cm deep and 220-420 cm to the ceiling (default
  320 x 280 x 250 cm). **Room scale** (`room-size-presets`) sets `room-preset-compact`,
  `room-preset-living`, `room-preset-gallery` or `room-preset-loft` in one undo step;
  the matching pill reads pressed, and an edited envelope leaves every pill up. Four walls: north at Z 0, east at X = width, south at Z = depth
  and west at X 0. Each wall shares Wall Studio coordinates in its own frame: `Left X`
  from its left corner seen from inside the room and `Bottom Y` in cm, modules extruded
  to their catalog depth into the room. North and south span the width, east and west
  the depth.
- The page is a full-bleed workstation (`.room3d-workstation`, basalt `#0c0c0e` with
  `#242220` dock seams): a header bar, the left dock (envelope, lighting, asset shelf),
  the stage (72vh), the right dock (outliner and inspector) and the bottom dock (KPIs,
  project, cloud save, cart sync, engineering telemetry and CAD bridge). From 1280px the
  docks sit beside the stage and scroll on their own; from 960px the inspector moves
  under the stage; below 960px everything stacks. **Zen** (`toggle-zen-viewport`) folds
  both docks and makes them inert.
- The **Lumen Spatial Engine** boot (`studio-boot-overlay`) is portaled to the body as
  a fixed 100vw x 100vh plate (`z-index: 9999`, `#080809`) over the navbar and every
  dock while the WebGL chunk loads: a 56 px monogram with a breathing tungsten aperture,
  `LUMEN SPATIAL ENGINE v6.1`, a 240 px bar from `000%` and `01 / WebGL2 Shader
  Pipeline`, `02 / 4-Wall Raycast & Gizmo Solver`, `03 / 24V Photometric Kernel`. It
  holds 950 ms after the canvas reports ready, then lifts over 550 ms on
  `cubic-bezier(0.16, 1, 0.3, 1)` (opacity to 0, scale to 1.025, blur to 10px) while the
  workstation (`data-boot`) settles from 0.99 to full size and drops its transform. It
  clears at once under reduced motion and on **Enter Studio Now** (`skip-studio-boot`).
  Only that key takes the pointer, so everything under it is live from the first frame.
- Camera lenses (`camera-lens-switcher`): `camera-mode-orbit`, `camera-mode-walkthrough`
  (Inside Room, 165 cm) and `camera-mode-elevation`. The lens is view state; the orbit
  camera still persists. `src/lib/room-walkthrough.js` holds the observer: bearings 0
  north, 90 east, 180 south, -90 west, 25 cm steps, 15 deg turns, a 32 cm wall buffer and
  the floor reference grown by 20 cm, the facing wall, eye illuminance on the plane facing
  the gaze, and the elevation lens. The inside lens is 78 deg; the wheel (4 deg a notch,
  written straight to the camera and committed after a 180 ms pause; a tick that lands
  between a commit and its re-render is kept, never pulled back by the echo) and `+` /
  `-` swing it between 50 and 92 deg, and `Home` or **Reset Stance** restores stance and
  lens. `defaultStance(room, wall)` centres the eye across the wall in view and backs it
  up to 78 percent of the way from it; `rescaleStance` carries the eye to the same
  relative spot when the envelope is resized. The mirror carries it as
  `room-walkthrough-state` (`data-camera-mode`, `data-x-cm`, `data-z-cm`,
  `data-eye-cm`, `data-heading-deg`, `data-pitch-deg`, `data-fov-deg`,
  `data-facing-wall`, `data-eye-lux`, and `data-lens-live="inside"` once the inside rig
  in the WebGL tree takes input) beside `room-wall` and
  `room-ceiling` nodes whose `data-visible` follows the section cut every frame.
- Direct manipulation: press the selected module (a 4 px threshold keeps clicks as
  clicks) or a gizmo handle (`gizmo-axis-x`, `gizmo-axis-y`, `gizmo-axis-xy`) and drag.
  Orbit is held off while a module is in hand. `room-transform-gizmo` carries
  `data-module-uid`, `data-wall`, `data-x-cm`, `data-y-cm` and `data-axis-lock`;
  `room-live-dimensions` carries `data-floor-cm`, `data-left-cm`, `data-right-cm` and
  `data-ceiling-cm` with `Y:`, `X:`, `R:` and `C:` labels. Grid Snap (`room-grid-snap`)
  and the Axis Gizmo Lock (`gizmo-lock-mode`) set how a drag lands.
- The **Wall Selector** (`active-wall-switcher`, tabs `wall-tab-north` ... `west`, each
  with a module count badge) sits in the header and sets the active wall. Mounting places a part on it at the
  first clear spot, keeping clear of modules on the adjoining walls at the corners and of
  the floor reference. The inspector's **Mounted on** select (`module-wall-select`)
  rehangs a module on another wall; **Clear Wall** in the HUD empties the active wall
  after a confirming second press. Both are undoable; the active wall is view state.
- Conflicts are checked wall by wall (overlap and bounds) and, between walls, as true 3D
  boxes, so two shelves meeting in a corner collide even though each wall is clear.
- WebGL engine. `src/lib/room-scene.js` is a pure scene description: it turns the room
  state (cm) into mesh, material and light records in metres, deterministic and
  testable without a GPU. `RoomCanvas.jsx` maps those records onto React Three Fiber:
  `BoxGeometry` and `CylinderGeometry` primitives with `MeshStandardMaterial` in the
  finish colour (Walnut, Oak, Obsidian, Chalk; timber matte, obsidian with a soft
  sheen), single-sided interior wall planes that cull themselves once the camera orbits
  past, and section-cut poche slabs that hide the same way.
- Each module record carries its wall-frame size, its room-frame centre and `rotY`
  (0 north, -90 deg east, 180 deg south, +90 deg west); emitters, felt panels and every
  light position and target go through the same transform. A wall between the camera and
  the room centre hides with its poche, its modules and their SKU tags as a section cut,
  while its lights keep lighting the room.
- The canvas is transparent over a warm horizon gradient (`--room-horizon`). Night
  walls and floor carry an emissive floor tone (`#262320`, `#1c1a17`) and a perimeter
  trim; with no channel lit the ambient and sky fill lift further. Daylight walls are
  `#dcd7ce` over a `#b8b0a4` floor.
- Lighting: ambient and hemisphere fill plus a directional sun with a 1024 px PCF shadow
  map, turned with the active wall so it falls over the viewer's shoulder. Every lit module adds its own light in its CCT: a `SpotLight` washing the wall
  below shelves, cubes, sideboards, lightbars (up and down) and the monopoint spot, a
  `PointLight` for the floor column and the backlit art frame halo. Intensity scales with
  rated lumens. Switching the 24V channel off removes the light and darkens the emitter.
- Camera: drei `OrbitControls` (no pan, no damping) with a free azimuth: a drag keeps
  turning round all four walls, and yaw, measured from the active wall's heading, wraps
  through +-180 deg (`wrapYaw`; stored values fold into (-180, 180]). Pitch runs 5 to 85
  deg, a near plan view, and zoom 0.45-2.4x through polar and distance limits. A wall tab
  glides the heading and orbit centre on the same spring, and a preset or key glides the
  yaw, both the short way round, while the relative yaw, pitch and zoom stay put. A drag
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
- Night Ambient (2700K) or Daylight Studio. Night keeps a moonlit sun and a legible
  fill so the LED washes carry the room, daylight raises the sun and fill until the
  fixtures read as accents.
- Technical mode adds edge outlines (hidden edges drawn faint through the solids), X / Y
  / Z axes in cm, SKU tags and clearance callouts: walkway, headroom over the furniture,
  floor and ceiling. Labels are DOM elements projected over the canvas.
- **Load from 2D Wall Studio** reads `lumen_wall_studio_v1`, or the Nordic Reading Wall
  when it is empty, onto the active wall: its width becomes that wall's span, the other
  walls stay. **Push to 2D Wall Studio** writes the active wall back, capped at the
  400 cm studio width. **Sync Room to Cart** merges the modules and opens the drawer.
- **Export 3D .OBJ** writes `lumen-room-<name>.obj` through `buildRoomObj(state, name)` in
  `src/lib/obj-export.js`: a `# Lumen 3D Export` header, six shared `vn` axis normals,
  then one `o` object per surface group. `room_envelope` is the floor and four walls
  facing into the room; each reference furniture part is a box
  (`furniture_sofa-200_back`); each module is its catalog box (`dimsCm.w x h x d`) at its
  wall position carried into the room frame (`module_01_LMN-SH-110_floating-shelf-110`,
  with a `_east`, `_south` or `_west` suffix off the north wall). Units are cm in the
  room frame (x along the north wall, y up, z toward the south wall), which Y-up CAD and
  DCC tools import as is. Faces are quads wound counter-clockwise around their normals.
  Object names are single tokens of `[A-Za-z0-9_-]`; free text only reaches comment
  lines, reduced to printable ASCII.
- **Capture .PNG** (`capture-room-png`) downloads `lumen-room-<name>.png`: a 1600 x 1000
  studio render card from `composeRoomSnapshotCanvas` in `src/lib/render-snapshot.js`. The
  live WebGL frame is drawn once on demand (`advance()`) and read in the same task, so the
  canvas never pays for `preserveDrawingBuffer`; if that read is blank (no WebGL, or a
  software rasteriser that keeps its buffer) a drafted axonometric of the envelope stands
  in. Under it, a specification strip stamps `LUMEN 3D SPATIAL STUDIO`, the sanitized
  project name, room size, camera lens, modules, 24V load, illuminance and RT60.
- The summary leads with Modules, 24V Load, Luminous Flux and Total Price beside the
  project name, cloud save and cart sync. Below it, **Engineering Telemetry & CAD
  Bridge** holds the driver, the 24V bus run around the unrolled walls, the Acoustics &
  Illuminance readout for the whole room, the Floor Lux Grid cell, the 2D bridge, the
  `.OBJ` export, the `.PNG` studio render and the share link.
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
- **Test Room Echo** (`audition-room-acoustics`, accessible name `Test Room Echo (Audition
  RT60)`, both planners): `synthesizeAcousticProfile` in `src/lib/acoustic-audition.js`
  turns the six bands into decay rates (`ln(1000) / RT60`), a C50 clarity figure, a
  damping percentage and a 32-point energy decay curve in dB on the spectrum's fixed
  2.5 s axis. `playAcousticAudition` plays a soft architectural wood clap
  (`woodClapSamples`: a 6 ms transient, two damped hardwood body modes at 720 Hz and
  1.88 kHz and a pink tail, seeded and peak-normalised) split into six one-octave
  band-passes, the top octaves eased off, each ringing out on its own RT60 through
  `setTargetAtTime` (time constant `RT60 / ln(1000)`), under an open D chord whose
  partials swell in over 25 ms and each sustain on the band they sound in, at a master
  gain of 0.28. The decay curve (`acoustic-decay-wave`, `data-rt60`,
  `data-baseline-rt60`, `data-damping-pct`) lights sample by sample as a playhead crosses
  it in real time; an amber hairline marks this room's RT60 and, once absorbers take at
  least 1 percent off, a dashed one marks where the bare room's echo would end. Beneath
  it `acoustic-echo-readout` reads `Echo: 1.26 s vs. 1.56 s bare (-19% reverb)`, or
  `Bare room echo 1.56 s - add acoustic panels to damp`. Without Web Audio the curve still
  runs, silently, and the context is closed when the take ends.
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
- The **Logistics & Crate Schedule** reads net / gross mass, crated volume, freight class
  and dispatch window, then lists each crate (`CRT-01`, dimensions, gross mass, SKUs) and
  each dispatch wave. **Consolidated Dispatch** and **Split Rough-In Dispatch** switch
  the waves without changing a price. The section prints without the switch and exports
  as `logistics` in the spec JSON.
- An empty cart renders the wall elevation empty state inside a bento tile.

## Share links

- **Share Link** in either planner encodes the workspace and project name into
  `<origin>/<planner>?scene=<Base64URL>`, copies it (Clipboard API, then an
  `execCommand` fallback; a blocked clipboard leaves the link on the key's
  `data-share-url`) and confirms with a toast. Payloads are positional arrays of part id,
  finish, X, Y and channel flags, at most 4096 characters. A room module off the north
  wall appends its wall code (`e`, `s`, `w`) as the 8th element; north tuples stay as
  they were, and an unknown code refuses the link.
- Opening a link loads the scene as one undoable step, adopts its project name, toasts
  `Loaded shared scene: <name>.` and strips `scene` from the address bar with a history
  replace, so a reload keeps later edits. Other query parameters survive.
- `decodeSceneParam` (`src/lib/scene-codec.js`) never throws. It refuses anything over
  4096 characters, outside the Base64URL alphabet, not UTF-8, not JSON, of the other
  planner's kind, carrying a `__proto__`, `constructor` or `prototype` key (escaped or
  not), or with any module that does not survive `sanitizeLayout` / `sanitizeRoomState`.
  A refused link keeps the local draft and shows `Shared scene link is invalid.`

- Quick-launch links: `?lens=orbit|inside|elevation` picks the camera lens and
  `?scale=compact|living|gallery|loft` a room scale preset (one undo step; the
  observer follows the envelope, so `?scale=loft&lens=inside` stands at 400 / 507 cm
  in an 800 x 650 x 340 cm room). Values are matched against the planner allow-lists,
  anything else is ignored, and both parameters leave the address bar with a history
  replace on arrival (`src/lib/launch-presets.js`, `useLaunchPreset`).

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
  `RequireAuth` and redirects to `/` when signed out. The page is one bento grid on the
  fixed page atmosphere (see Design system). Each tile is lit from its top edge (a soft
  tungsten radial over the bento surface) and carries a champagne hairline inside its
  border, the profile tile with a warmer corner light, and saved project cards repeat it
  at a smaller scale. A full-width profile tile shows the name, email, transport, library, sync
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
- **Compare** on a card opens the **Project comparison** dialog with that project as
  Baseline (A) and, as Target (B), the newest other project of the same kind, then any
  other project, then that kind's live draft. With two or more projects saved, **Compare
  Projects** in the panel head compares the two newest, older as A. Both selects list
  every saved revision and the live Wall Studio and Room Planner drafts; **Swap**
  exchanges them. The dialog code loads in its own chunk on first open.
- **Studio Engineering Tickets** spans the row beneath (`account-tickets-section`):
  every `LMN-T-XXXXXXXX` ticket in the library with its subject, status (**Queued for
  Engineering Review**), submit time, escalation path, transcript length, reply address,
  the escalated inquiry and the attached workspace digest. A ticket written offline shows
  as a device copy until the outbox replays it.

## Studio AI Concierge

`ConciergeWidget` is mounted once in the layout shell, after the page in DOM order, so the
conversation survives every route change and never enters the page's tab sequence early.

- **Dock.** A 40 px **Ask Lumen** pill fixed 20 px from the bottom-right corner
  (`z-index: 90`) in the navbar's dark glass: `rgba(20, 19, 17, 0.92)` on a 16 px backdrop
  blur, a 1 px `rgba(255, 255, 255, 0.12)` edge, `#f4f1ea` text and the Lumen mark with
  its aperture in champagne. Hovered or open, the edge warms to `rgba(229, 199, 153,
  0.45)`. Under 560 px it compacts to a 40 x 40 key with the same accessible name. The
  panel chunk (and the engine behind it) loads on pointer or focus intent, never with the
  entry.
- **Layout guard.** While any `aria-modal` dialog is open (sign-in, cart, palette,
  blueprint, compare) or the 3D camera popover is open, the dock steps aside
  (`visibility: hidden`) and returns with its session intact. `scroll-padding-bottom:
  76px` on the root keeps anything scrolled into view from below (keyboard focus, find in
  page, end-aligned anchors) clear of the pill.
- **Panel.** A non-modal dialog (`aria-label="Lumen Studio AI Concierge"`,
  `data-escalation="locked" | "unlocked"`, `data-thread="welcome" | "active"`),
  `min(400px, 100vw - 32px)` wide and `min(700px, 100dvh - 96px)` tall, in dark glass: a
  header (the Lumen mark, **Lumen AI**, a **Workspace Aware** badge, the route as a quiet
  pill, **New chat** once the thread has started, close), the thread and a pill composer
  (`#181715`, 999 px radius, a champagne edge on focus) with a round **Ask** key inside.
  Escape from inside closes it and focus returns to the pill. Before the first message
  the thread shows a welcome: the mark, **How can I help with your space?**, one line and
  the four route-aware starters as cards with arrows. Once the thread starts the starters
  fold into a single scrolling row of chips (at most 34 px) docked on the composer, so the
  thread keeps at least 80% of the full-height panel; **New chat** returns to the welcome
  with the gatekeeper locked again, and a reply still in flight from the old thread is
  dropped. Questions sit in warm charcoal-bronze bubbles on the right (`#2a2621`, a
  `rgba(229, 199, 153, 0.22)` edge, 18 18 4 18 radius, at most 82% wide). Answers sit
  straight on the glass beside a 22 px Lumen avatar: the category, the lead sentence, the
  bullets with their labels in bold, up to four metric pills, pill-shaped next steps (the
  first a champagne cap) and, on resolved answers, an understated **Did not resolve my
  issue - request engineer** link; closing notices read as a champagne-ruled callout.
  Confidence and sources show in Specs mode only. A fresh answer streams in once, top to
  bottom under a soft mask edge, and marks itself `data-revealed` on the element (never
  through React state), so a reopened panel never replays it; reduced motion shows it at
  once.
- **Answer format.** Every answer is one lead sentence, then two to four `- Label: value`
  bullets, 35 to 65 words, with at most four metrics: a datasheet reads Size, Light,
  Mounting and Order; an audit reads Power, Acoustics, Light and Layout; a question about
  one figure ("check my wall voltage drop") gets two bullets on that figure. Escalations
  keep their lead and scope bullet and close on the unchanged notice; the gatekeeper reply
  is unchanged. The text stays plain ASCII with no markup, so the API, the transcript and
  the device answer read the same.
- **Engine.** `evaluateConciergeQuery(question, workspaceContext)` caps the question at
  500 characters and rebuilds the context (`route`, `currency`, `wallDraft`, `roomDraft`,
  `bagItems`) through `sanitizeLayout`, `sanitizeRoomState` and `sanitizeBagItems`. It
  scores catalog, electrical, physics, spatial and commerce signals, matches every part
  by name, alias and SKU, and composes answers from the canonical modules: the catalog,
  `DRIVERS`, `maxRunM`, `LIGHTING_SCENES`, `computeEnvironmentalPhysics`,
  `computeBusTopology`, `findRoomConflicts`, `buildQuote` and
  `computeLogisticsSchedule`. Questions about *my* wall, room, design or cart read the
  live drafts (`lumen_wall_studio_v1`, `lumen_room_3d_v1`, `lumen_bag_v1`) at question
  time. Every reply is `{ id, question, answer, confidence, category, resolved,
  citations, suggestedActions, metrics }`; resolved replies score 0.65 and above.
- **Studio guide.** Before matching, the question is folded: contractions with or
  without the apostrophe (`cant`, `can't`, `won't`), common typos and the many names of
  the planners (`3D room designer`, `3D modeler`, `room planner`, `wall studio`). How-to,
  navigation and fault questions about the app itself answer in the `guide` category
  ahead of the topic words they mention: opening the 3D Spatial Studio (and why it may
  not open), moving and placing modules in 3D and 2D, the three lenses and room size,
  Visual and Specs, the top bar, keyboard shortcuts and Zen, the Wall Studio, the cart,
  saving, signing in, search and removing a module. Opening the 3D studio always carries
  **Launch 3D Spatial Studio** (`/room-3d`) and **Launch 165 cm Walkthrough**
  (`/room-3d?lens=inside`). Greetings and "what is Lumen" get a short tour of the
  platform. Escalation topics still win first, and software faults ("the 3D designer is
  broken") or planner sizes ("a custom size for my room") never read as freight damage
  or bespoke work.
- **Transport.** `askConcierge` answers with the server's reply when it gets a sound one;
  on any other outcome (unreachable, a 404 from an older dev server, a 5xx, a refused or
  unreadable reply) the same engine answers on the device with the same reply id, and
  only an unreachable API moves the cloud indicator offline. No server message ever
  reaches the conversation.
- **MCP server.** `src/lib/mcp-server.js` is a transport-free Model Context Protocol
  endpoint, `handleMcpRequest(message, { version, workspace })`, mounted by
  `server/app.js` at `POST /api/mcp`. It validates the JSON-RPC 2.0 envelope (`-32700`
  parse, `-32600` invalid request, `-32601` unknown method, `-32602` invalid params,
  `-32002` unknown resource) and answers `initialize` (protocol `2025-06-18`, server
  `lumen-spatial-mcp`), `ping`, `notifications/initialized`, `resources/list` and
  `resources/read` (`lumen://catalog/products`, `lumen://electrical/drivers-and-bus`,
  `lumen://acoustics/sabine-6octave`, `lumen://workspace/live`), `prompts/list` and
  `prompts/get` (`audit-room-3d`, `size-24v-bus`, `optimize-acoustics-rt60`), and
  `tools/list` and `tools/call`. The eight tools carry strict JSON Schemas
  (`additionalProperties: false`, enums for every part, finish, wall, preset, scene and
  lens): `inspect_workspace`, `query_catalog`, `simulate_physics_and_bus`,
  `mutate_3d_room`, `mutate_2d_wall`, `manage_cart_bag`, `lookup_studio_guide` and
  `unlock_engineering_escalation`. Results are
  `{ content: [{ type: 'text', text }], structuredContent, clientActions, isError }`. Tools
  never write storage: a mutation returns the next sanitized room, wall or cart as a
  client action (`apply_room_state` with an optional active wall, lens and module to
  select; `apply_wall_state`; `apply_bag_items`), and a refused edit (a finish the part
  does not ship in, a full wall) is `isError: true` with nothing changed. A remote caller
  passes its workspace as `params._meta["lumen/workspace"]`, validated as strictly as
  `/api/concierge/ask`; a browser `Origin` other than the host gets `403`.
- **Agent.** `server/llm-agent.js` picks the provider from `LUMEN_LLM_PROVIDER` (`auto`
  by default), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` or
  `LUMEN_LLM_BASE_URL` (Ollama or any OpenAI-compatible server) and `LUMEN_LLM_MODEL`,
  reading the process environment first and then an optional `.env` (LLM keys only). It
  streams the provider's Server-Sent Events over zero-dependency `fetch`, passes the
  `tools/list` definitions, runs each requested call through `tools/call`, feeds the
  structured result back (never the full client state) and folds the final answer to
  plain ASCII bullets, for up to four rounds. Resolution stays decided by the question
  text, so the escalation gate still replays it. A provider fault or a 25 s timeout falls
  back to the deterministic orchestrator; keys never reach a log line or the client.
- **Deterministic orchestrator.** `src/lib/mcp-orchestrator.js` is the key-free agent,
  shared by the server and the browser's offline fallback. `src/lib/agent-intent.js`
  turns an imperative request (mount, remove, clear, set the preset, size, furniture,
  lighting rig, scene, lens or active wall; add, remove, clear or sync the cart) into one
  mutation tool's arguments; a question never reads as a command, and a bespoke request
  phrased as one still goes to studio engineering. Other questions run the inspection
  tool for their topic (`inspect_workspace`, `query_catalog`,
  `simulate_physics_and_bus`, `lookup_studio_guide` or
  `unlock_engineering_escalation`) and keep the engine's answer and reply id word for
  word. Agent replies use the `agent` category (**Agentic Workspace Action**), a lead
  that says what changed, then Room or Wall or Cart, Power, Acoustics and Undo bullets.
- **Workspace bus.** `executeClientActions` (`src/lib/workspace-bus.js`) rebuilds each
  client action through `sanitizeRoomState`, `sanitizeLayout` or `sanitizeBagItems`,
  writes it to the store the planners and the cart read, and announces it as a
  `lumen:workspace-mutate` window event (`subscribeWorkspaceMutations`, from the
  engine-free `workspace-events.js`). A mounted planner turns it into one history step:
  `useRoom3d` replaces the room (keeping the camera, switching the active wall and
  selecting the new module), `RoomPlannerPage` switches the lens and `useWallStudio`
  imports the layout, so `Ctrl+Z` reverses the AI edit whole and an edit that changes
  nothing leaves no empty step. The cart provider rehydrates and toasts the change; an
  unmounted planner opens on the stored result. `useConcierge` runs the bus for every
  reply that carries actions, except one that lands after **New chat**.
- **Tool trace.** Every reply that ran MCP tools shows a strip of flat chips above the
  lead (`concierge-tool-calls`), one per call: `MCP // tool_name: what it did`, with a
  champagne left rule, or amber for a refused edit. The panel carries
  `data-mcp="2025-06-18"`.
- **Gatekeeper.** Bespoke fabrication outside the catalog, structural, masonry or
  wet-zone certification, onsite crew booking, freight damage and claims, B2B invoicing
  and off-topic requests resolve `false` under 0.45 and unlock contact with reason
  `unresolved_query`. **Did not resolve my issue** adds a deeper engineering follow-up and
  unlocks with `marked_unhelpful`. A request for a human alone gets the gatekeeper reply
  and stays locked. Resolution depends on the question text only, so the server's replay
  agrees with what the visitor saw. The gatekeeper is silent while locked: its status
  (`concierge-gatekeeper-status`, `role="status"`) stays in the DOM as a visually hidden
  live region, so screen readers hear it and the unlock is announced as a change, but no
  padlock or lock line is ever painted; once contact unlocks it shows as a calm champagne
  line above the composer.
- **Tickets.** The unlocked **Contact Studio Engineering** form takes Email (pre-filled
  when signed in), Subject (2 to 120 characters, pre-filled from the inquiry) and an
  Engineering Brief (10 to 2000), and attaches the transcript and a 600-character
  workspace digest. `POST /api/concierge/escalate` replays the transcript (the unlocking
  turn is always kept within the 24-turn cap), checks the fields and the reason, and
  issues the reference from `node:crypto`. Up to 12 tickets per library, merged into the
  account on sign-in like quotes. Offline, the same gatekeeper runs on the device and the
  ticket waits in `lumen_cloud_ticket_outbox_v1` until the next reachable call replays it
  through the server.

## Command palette

- `Ctrl+K` (or `Cmd+K`) anywhere opens a warm basalt spotlight (`role="dialog"`,
  `rgba(18, 17, 15, 0.96)` on a 24px backdrop blur, a `rgba(229, 199, 153, 0.18)` hairline,
  a champagne light along its top edge, 16px radius, 540px wide) that resolves in from
  scale 1.04 and an 8px blur. The same keys
  close it again; it never opens on top of the cart drawer or the sign-in dialog. The
  first navbar pill (glyph and `Search` only; the shortcut lives in its tooltip) opens it
  too and folds to its glyph below 700px.
- One search field (`Search lighting, furniture, or pages...`) ranks matches within three
  fixed groups: **Pages** (Overview, Catalog, 3D Room Planner, 2D Wall Studio, Project
  Quote, Account, each with a plain subtitle), **Products** (all 12 parts; Enter opens the
  spec sheet) and **Actions** (Switch to Specs or Visual Mode, Set Currency: USD, EUR or
  HUF, Open Cart Drawer). In Visual mode a product row shows its drawing, its name, a
  plain subtitle (`Lighting - 150 x 12 cm`) and a price pill; its SKU, a page's path and
  a part's 24V load stay in the DOM for search and show only in Specs mode. The footer is
  one line, `Up/Down to navigate - Enter to open - Esc to close`, and the result count
  is announced to screen readers rather than shown. A label prefix outranks a word start, which outranks any other match, and
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
- The escalation gatekeeper is enforced on the server: client `resolved` and
  `markedUnhelpful` flags count only when the engine reproduces them on replay, so a
  forged transcript answers `400 gatekeeper_locked`. Concierge replies are rebuilt by
  `sanitizeConciergeReply` on the client, and every suggested action must pass
  `isSafeInternalPath` before it reaches the router.

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

`npm run dev` and `npm run preview` serve the API on `/api` in the same process.
`vite.config.js` never imports the server modules statically (a config dependency would
make Vite restart the whole dev server on every edit, and a restart that fails half way
through a branch switch leaves the old route table running). Under `npm run dev` the API
loads through the dev server's SSR module graph on each request, so an edit under
`server/` or `src/lib/` reaches the next call with no restart (logged as `lumen cloud api
reloaded`), the store flushes before the new one opens, and a per-process session key
keeps every session valid across reloads. `npm run preview` serves a fixed build with one
cloud per process. The standalone server reads `HOST`, `PORT`, `LUMEN_DATA_FILE`, `LUMEN_STORAGE`,
`LUMEN_SESSION_SECRET` and `LUMEN_TEST_RESET`. Lumen AI reads `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `LUMEN_LLM_BASE_URL`, `LUMEN_LLM_MODEL` and
`LUMEN_LLM_PROVIDER` from the environment or a git-ignored `.env`; with none set it runs
the deterministic MCP orchestrator, and the E2E web server pins
`LUMEN_LLM_PROVIDER=deterministic` so a key on the machine never reaches a test run. Run one process per data file. The E2E
web server writes `server/.data/lumen-cloud.test.json`, so a dev server on the default
store can stay up during a test run.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests to `main` and
`develop`: `npm ci`, the Playwright Chromium binary, `npm run build`, then
`npx playwright test` against the built bundle on four parallel workers (every browser
context owns its `X-Lumen-Client` namespace in the isolated test store). The browser
binary is cached under `~/.cache/ms-playwright` with `actions/cache@v5`, keyed on the
lockfile hash, and downloaded only on a cache miss. The HTML report is uploaded only when
the run fails. On CI the four workers share a four-vCPU runner where WebGL falls back to
software rasterisation, so the long 3D scenario tests get a 60 s test budget and a 10 s
assertion budget there (30 s and 5 s locally); both are ceilings, never waits.
`ubuntu-latest` already carries Chromium's shared libraries and every font is
self-hosted, so the job installs no apt packages and does not depend on Ubuntu mirrors.
Every action is pinned to a major that declares Node 24 (`actions/checkout@v5`,
`actions/setup-node@v5`, `actions/cache@v5`, `actions/upload-artifact@v6`), and
`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` is set for the whole workflow as a safeguard, so the
runner raises no Node 20 deprecation warning.
Releases push `develop` and `main` at the same SHA; triggering pushes on `main` only, with
`concurrency` grouped by ref and `cancel-in-progress`, yields one run per release. The
local build and full suite are the release gate; after a push, one query to the GitHub
Actions API confirms the run was dispatched and records its id.

## Workflow

- `main` holds releases, `develop` integrates, each milestone lands on a short-lived
  `feat/*` branch. Once `develop` and `main` are pushed, the feature branch is deleted
  locally and on `origin`, so only `main` and `develop` stay published.
- Only major releases are tagged: `v1.0.0`, `v2.0.0`, `v3.0.0`, `v4.0.0`, `v5.0.0`, `v6.0.0`. Minor and patch
  releases ship untagged and are recorded in the release history above.
- Releases advance `develop` and `main` by pointer (`git branch -f`) from the finished
  feature branch, never by switching back first, so no working-tree directories are
  deleted on synced (OneDrive) folders.
- Lower-case Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `security:`, `docs:`.
- Test files are named by domain, for example `app-shell.spec.js`.

## License

MIT License, Copyright (c) 2026 s7codes. See [LICENSE](LICENSE).
