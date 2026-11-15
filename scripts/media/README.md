# Lumen media pipeline

The stills and the hero and room films under `public/media/` are generated from this repository:
path-traced renders of the planner's own parametric parts and furniture (`src/lib/room-scene.js`),
so a catalog photograph and the 3D Room Planner show the same object. The Meet our Icons reel is
real camera footage of architectural interiors: three Pexels clips under the Pexels License,
fetched, verified, cut and graded by `make-footage.mjs`. Nothing is hotlinked; every file is served
from the app's own origin.

The pipeline is an offline authoring tool. Nothing here is imported by the app, built by Vite or
run in CI; the app only reads the finished files listed in `src/lib/media-manifest.js`.

## Requirements

- `ffmpeg` with `libwebp`, `libvpx-vp9` and `libx264` on `PATH`, or its path in `FFMPEG`.
- For the renders only: a WebGL2-capable GPU (the path tracer runs in headless Chromium through
  ANGLE, `--use-angle=d3d11` on Windows; use `--use-angle=vulkan` or `gl` elsewhere) and the
  studio's own dependencies: `cd scripts/media/studio && npm install`. They are kept out of the
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
4. **Camera footage** (`make-footage.mjs`). The three films of the Meet our Icons reel, in reel
   order: a wave-shaped timber pendant (Pexels 39024324, Alef Morais), low sun across sculpted
   plaster niches (Pexels 35660680, Raphael Kim) and a recessed step light on an oiled timber
   stair (Pexels 39024320, Alef Morais). Each source is fetched once from the Pexels video CDN into
   `.work/footage/` and checked against its pinned SHA-256, then cut to `ICON_FILM_SECONDS` from an
   in point chosen frame by frame, scaled to 1920 x 1080 at 29.97 fps with Lanczos and graded with
   one light contrast, saturation and gamma pass in BT.709 into a lossless FFV1 master. Each clip
   is encoded at its own rate (the soft, defocused clips need a lower CRF to keep their wood grain)
   with a WebP poster of frame 0. `node make-footage.mjs [pendant plaster stair]` rebuilds any of
   them. Every clip was checked frame by frame before it was picked: camera originals with camera
   timecode where the source carries one, no watermark and no text in the picture.
5. **Catalog** (`make-catalog.mjs`). One 1600 x 1200 photograph per part and finish.

Re-run the affected stages when the catalog, a part's CAD sub-assembly or the planner camera
changes. The E2E suite (`tests/media-assets-and-cinema.spec.js`, `tests/icons-reel.spec.js`)
audits every promised file: its presence, its pixel size, its container, its length and its weight.
