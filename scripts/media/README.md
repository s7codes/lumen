# Lumen media pipeline

Everything under `public/media/` is generated from this repository: no stock photography, no
hotlinks. The stills are path-traced renders of the planner's own parametric parts and furniture
(`src/lib/room-scene.js`), so a catalog photograph and the 3D Room Planner show the same object.
The Meet our Icons reel and the four 3D Spatial Studio showcase films are shot on the cinema stage
(`cinema/`), an accumulation renderer that is noise-free by construction.

The pipeline is an offline authoring tool. Nothing here is imported by the app, built by Vite or
run in CI; the app only reads the finished files listed in `src/lib/media-manifest.js`.

## Requirements

- A WebGL2-capable GPU (the path tracer runs in headless Chromium through ANGLE, `--use-angle=d3d11`
  on Windows; use `--use-angle=vulkan` or `gl` elsewhere).
- `ffmpeg` with `libwebp`, `libvpx-vp9` and `libx264` on `PATH`, or its path in `FFMPEG`.
- The studio's own dependencies: `cd scripts/media/studio && npm install`. They are kept out of the
  app's `package.json` on purpose (`three-gpu-pathtracer` wants a newer `three-mesh-bvh` than drei).

## Stages

1. **Light passes** (`studio/`, `render.mjs`). `npm run studio` serves the studio page;
   `node render.mjs [filter]` renders each job of `jobs.mjs` in headless Chromium: the hero room,
   the three portrait rooms and every catalog part in every finish it ships in. Each shot is
   rendered as separate light passes (sky, sun, one per LED channel) and saved as linear float
   RGB, with rasterised albedo, normal and depth guides. Light transport is linear, so any
   balance of the passes, and every film frame, is a weighted sum of them.
2. **Grade** (`grade-lib.mjs`). Fireflies out, a guided a-trous filter on albedo-demodulated light,
   a linear lens point-spread function, then exposure, white balance and three.js AgX. Stills go
   out as WebP through ffmpeg's libwebp.
3. **Films** (`make-hero.mjs`, `make-rooms.mjs`). Seamless 60 fps loops composed frame by frame
   from the passes (a cloud over the sun, DALI channels breathing, a room turning from day to
   dusk), written to a lossless FFV1 master, then encoded as VP9 WebM and H.264 MP4 with fast start.
4. **Cinema stage** (`cinema/`, `cinema.mjs`, `make-icons.mjs`, `make-showcase.mjs`). A Three.js
   page where one film frame is the mean of 40 to 112 sub-frames. Each sub-frame moves the camera
   inside its pixel (anti-aliasing), across the lens aperture with the focal plane held (depth of
   field), inside a 180 degree shutter (motion blur) and moves every light across its emitter
   (soft shadows, true line sources for the linear pendant and the column). A raymarched
   single-scattering pass adds the 2700K haze of each spotlight, integrated with equiangular
   sampling so the inverse-square peak at the source is cancelled exactly. Every offset walks a
   fixed stratified pattern through its own fixed shuffle (a Latin hypercube): no random draws,
   no grain, the same frame renders the same pixels. One output pass adds an energy-conserving
   lens glare, a vignette, AgX and a sub-LSB ordered dither against banding.
   - `node cinema.mjs still <film> <seconds>` renders one PNG for review;
     `node cinema.mjs film <film,...>` writes FFV1 masters to `.work/cinema` (frame 0, the poster,
     with the shutter closed). The driver starts its own Vite server and Chromium on the GPU.
   - Icons (`icon-monolith`, `icon-suspension`, `icon-column`): 1920 x 800, 4 s at 60 fps, the
     dome lamp on travertine, the Linear Pendant 150 on the Track Bus 200 spine, the Floor Column
     140 among plaster scallops. `node make-icons.mjs` encodes them to `public/media/icons/`.
   - Showcase (`cad-orbit`, `cad-inside`, `cad-gizmo`, `cad-isolux`): 1440 x 960, the Gallery
     room as an obsidian CAD chamber with a 50 cm hairline lattice and the planner's own fixtures
     from `buildScene`, posed by `src/lib/showcase-film.js` and annotated from
     `src/lib/showcase-scene.js` (lux, dimensions, the iso-lux field evaluated per pixel from
     `lightSources`), so every figure in a film is the figure the HUD prints over it.
     `node make-showcase.mjs` encodes them to `public/media/showcase/`.
   The earlier RoomCanvas capture (`capture/`, `capture.mjs`) stays for reference.
5. **Catalog** (`make-catalog.mjs`). One 1600 x 1200 photograph per part and finish.

Re-run the affected stages when the catalog, a part's CAD sub-assembly, the planner camera or
the showcase choreography changes. The E2E suite (`tests/media-assets-and-cinema.spec.js`) audits every promised file: its
presence, its pixel size, its container and its weight.
