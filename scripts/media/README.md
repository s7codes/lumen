# Lumen media pipeline

Everything under `public/media/` is generated from this repository: no stock photography, no
hotlinks. The stills are path-traced renders of the planner's own parametric parts and furniture
(`src/lib/room-scene.js`), so a catalog photograph and the 3D Room Planner show the same object.
The showcase films are captures of the planner's WebGL2 canvas itself.

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
4. **Engine films** (`capture/`, `capture.mjs`, `make-showcase.mjs`). The capture page mounts the
   planner's `RoomCanvas`, drag controller and transform gizmo; the driver runs Chromium with
   reduced motion emulated, so every camera rig snaps to the pose it is handed, and films each act
   one 1/60 s frame at a time from `src/lib/showcase-film.js`, the same functions the overview HUD
   reads. Frames are captured at 2x and scaled down; the poster is frame 0.
5. **Catalog** (`make-catalog.mjs`). One 1600 x 1200 photograph per part and finish.

Re-run the affected stages when the catalog, a part's CAD sub-assembly or the planner camera
changes. The E2E suite (`tests/media-assets-and-cinema.spec.js`) audits every promised file: its
presence, its pixel size, its container and its weight.
