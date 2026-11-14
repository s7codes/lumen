/*
 * Geometry for the overview hero: two light architectural interiors drawn as
 * inline SVG on a 1600 x 900 view box. Rooms are modelled in centimetres and
 * projected through a one-point perspective camera, so every joint, reveal,
 * plank and cone lands where the architecture puts it. Pure: numbers in, SVG
 * path strings out. Nothing here touches the DOM, so the math is testable in
 * Node and the overview still loads no WebGL.
 */

export const HERO_VIEW = Object.freeze({ width: 1600, height: 900 });

export const HERO_SCENES = Object.freeze([
  Object.freeze({ id: 'wall-wash', label: 'Architectural wall wash and molded door reveal' }),
  Object.freeze({ id: 'gallery', label: '24V recessed track, linear pendant and lit walnut shelf' }),
]);

export const HERO_SCENE_IDS = Object.freeze(HERO_SCENES.map((scene) => scene.id));

// Each scene holds the frame for 5 s, then a 1.1 s crossfade hands it over.
// The CSS keyframes in home.css (hero-scene-cycle) mirror these numbers.
export const HERO_HOLD_SECONDS = 5;
export const HERO_CROSSFADE_SECONDS = 1.1;
export const HERO_CYCLE_SECONDS = 2 * (HERO_HOLD_SECONDS + HERO_CROSSFADE_SECONDS);

function smooth(t) {
  const v = t < 0 ? 0 : t > 1 ? 1 : t;
  return v * v * (3 - 2 * v);
}

/**
 * Opacity of the gallery scene laid over the wall-wash scene at clock t
 * (seconds): 0 through the first hold, an eased rise through the first
 * crossfade, 1 through the second hold, an eased fall through the second.
 */
export function galleryWeight(t) {
  const span = HERO_CYCLE_SECONDS;
  const value = Number.isFinite(t) ? ((t % span) + span) % span : 0;
  const rise = HERO_HOLD_SECONDS;
  const top = rise + HERO_CROSSFADE_SECONDS;
  const fall = top + HERO_HOLD_SECONDS;
  if (value < rise) return 0;
  if (value < top) return smooth((value - rise) / HERO_CROSSFADE_SECONDS);
  if (value < fall) return 1;
  return 1 - smooth((value - fall) / HERO_CROSSFADE_SECONDS);
}

/** The scene that owns the frame at clock t: the incoming one once it passes half strength. */
export function heroSceneAt(t) {
  return galleryWeight(t) >= 0.5 ? HERO_SCENE_IDS[1] : HERO_SCENE_IDS[0];
}

/* ---------- camera ---------- */

/**
 * One-point perspective camera fitted to a room: the back wall (at `depth`
 * cm from the eye) spans `floorY` to `ceilingY` on screen. x is the lateral
 * offset from the eye in cm, y the height above the floor, z the depth.
 */
export function roomCamera({ floorY, ceilingY, height, eyeY, depth, vx }) {
  const scale = (floorY - ceilingY) / height;
  const vy = floorY - scale * eyeY;
  const focal = scale * depth;
  return Object.freeze({
    vx,
    vy,
    focal,
    eyeY,
    depth,
    project(x, y, z) {
      const k = focal / z;
      return [vx + x * k, vy - (y - eyeY) * k];
    },
    scaleAt(z) {
      return focal / z;
    },
    /** Depth at which a point at height y on the floor or ceiling plane meets screen row sy. */
    depthAtRow(y, sy) {
      return (focal * (y - eyeY)) / (vy - sy);
    },
  });
}

const r1 = (v) => Math.round(v * 10) / 10;

export function polygonPath(points) {
  return `M${points.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;
}

export function polylinePath(points) {
  return `M${points.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}`;
}

/** Projects a polygon given as [x, y, z] corners. */
export function projectPolygon(camera, corners) {
  return corners.map(([x, y, z]) => camera.project(x, y, z));
}

/**
 * The visible faces of an axis-aligned box seen from the eye at (0, eyeY, 0):
 * the front face always, the top when the eye is above it, a side when the
 * eye sits beyond that side. Each face is a projected quad, far faces first.
 */
export function projectBox(camera, { x0, x1, y0, y1, z0, z1 }) {
  const p = (x, y, z) => camera.project(x, y, z);
  const faces = {};
  if (camera.eyeY > y1) faces.top = [p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0)];
  if (camera.eyeY < y0) faces.bottom = [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)];
  if (x0 > 0) faces.left = [p(x0, y1, z1), p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1)];
  if (x1 < 0) faces.right = [p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1), p(x1, y0, z0)];
  faces.front = [p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), p(x0, y0, z0)];
  return faces;
}

/* ---------- herringbone ---------- */

/**
 * Herringbone planks (width W, length L) covering a floor region, in floor
 * coordinates [x, z]. The 90 degree tiling has the lattice a = (W, W),
 * b = (L + W, W - L): every lattice point carries one plank along u and one
 * along v, and det(a, b) = 2 L W, so the two families tile the plane with no
 * gap. The pattern is then turned by `angle` (45 degrees reads as classic
 * herringbone) and centred on (cx, cz).
 */
export function herringbonePlanks({ width: W, length: L, xMin, xMax, zMin, zMax, angle = Math.PI / 4 }) {
  const cx = (xMin + xMax) / 2;
  const cz = (zMin + zMax) / 2;
  const reach = Math.hypot(xMax - xMin, zMax - zMin) / 2 + L;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const place = ([u, v]) => [cx + u * cos - v * sin, cz + u * sin + v * cos];
  const inside = (points) =>
    points.some(([x, z]) => x >= xMin - L && x <= xMax + L && z >= zMin - L && z <= zMax + L);
  const along = [];
  const across = [];
  // Lattice range: b moves (L + W) along u per step, a moves W along both.
  const mSpan = Math.ceil(reach / (L - W)) + 2;
  const kSpan = Math.ceil((reach + mSpan * (L + W)) / W) + 2;
  for (let m = -mSpan; m <= mSpan; m += 1) {
    for (let k = -kSpan; k <= kSpan; k += 1) {
      const u = k * W + m * (L + W);
      const v = k * W + m * (W - L);
      if (Math.abs(u) > reach + 2 * L || Math.abs(v) > reach + 2 * L) continue;
      const a = [
        [u, v],
        [u + L, v],
        [u + L, v + W],
        [u, v + W],
      ].map(place);
      const b = [
        [u + L, v + W - L],
        [u + L + W, v + W - L],
        [u + L + W, v + W],
        [u + L, v + W],
      ].map(place);
      if (inside(a)) along.push(a);
      if (inside(b)) across.push(b);
    }
  }
  return { along, across };
}

/** Projects floor planks ([x, z] corners, y = 0) and merges each family into one path. */
export function floorPaths(camera, planks) {
  const toPath = (list) => list.map((plank) => polygonPath(plank.map(([x, z]) => camera.project(x, 0, z)))).join('');
  return { along: toPath(planks.along), across: toPath(planks.across) };
}

/* ---------- light ---------- */

/**
 * The scallop a wall light throws along a flat wall. A cone meeting a plane
 * parallel to its axis cuts a hyperbola, so the half width grows as
 * w0 * sqrt(1 + (s / knee)^2) with distance s from the opening. `dir` is -1
 * for an uplight, 1 for a downlight. Samples crowd near the opening, where
 * the curve turns, so the edge stays crisp at any scale.
 */
export function conePath({ x, y0, dir, reach, halfWidth, knee, steps = 36 }) {
  const w = (s) => halfWidth * Math.sqrt(1 + (s / knee) ** 2);
  const left = [];
  const right = [];
  for (let i = 0; i <= steps; i += 1) {
    const s = reach * (i / steps) ** 1.5;
    const y = y0 + dir * s;
    left.push([x - w(s), y]);
    right.push([x + w(s), y]);
  }
  return polygonPath([...left, ...right.reverse()]);
}

/** Half width of a cone path at distance s from its opening. */
export function coneHalfWidth({ halfWidth, knee }, s) {
  return halfWidth * Math.sqrt(1 + (s / knee) ** 2);
}

/* ---------- Scene I: architectural wall wash and molded door reveal ---------- */

const WALL_WASH_ROOM = Object.freeze({ floorY: 765, ceilingY: 40, height: 280, eyeY: 150, depth: 500, vx: 1000 });

function buildWallWash() {
  const cam = roomCamera(WALL_WASH_ROOM);
  const { depth: D, height: H } = WALL_WASH_ROOM;
  const leftX = -270;
  const P = (x, y, z) => cam.project(x, y, z);
  const corner = P(leftX, 0, D)[0];

  // Side wall, ceiling and floor planes, clipped to the frame by the SVG. The
  // back planes run on behind the side wall, so its parallax never opens a seam.
  const nearZ = 300;
  const under = leftX - 90;
  const sideWall = polygonPath([P(leftX, H, D), P(leftX, H, nearZ), P(leftX, 0, nearZ), P(leftX, 0, D)]);
  const ceiling = polygonPath([P(under, H, D), P(900, H, D), P(900, H, nearZ), P(under, H, nearZ)]);
  const floor = polygonPath([P(under, 0, D), P(900, 0, D), P(900, 0, nearZ - 60), P(under, 0, nearZ - 60)]);

  // The doorway in the side wall: an 88 x 218 cm leaf set 12 cm into the
  // wall, a 9 cm architrave proud of the plaster, and the far and head
  // jambs of the reveal turned toward the eye.
  const door = { z0: 382, z1: 470, h: 218, recess: 12, trim: 9, proud: 2.5 };
  const wallX = leftX;
  const leafX = wallX - door.recess;
  const trimX = wallX + door.proud;
  const architrave = polygonPath([
    P(trimX, door.h + door.trim, door.z0 - door.trim),
    P(trimX, door.h + door.trim, door.z1 + door.trim),
    P(trimX, 0, door.z1 + door.trim),
    P(trimX, 0, door.z0 - door.trim),
  ]);
  const opening = polygonPath([P(trimX, door.h, door.z0), P(trimX, door.h, door.z1), P(trimX, 0, door.z1), P(trimX, 0, door.z0)]);
  const farJamb = polygonPath([P(trimX, door.h, door.z1), P(leafX, door.h, door.z1), P(leafX, 0, door.z1), P(trimX, 0, door.z1)]);
  const headJamb = polygonPath([P(trimX, door.h, door.z0), P(trimX, door.h, door.z1), P(leafX, door.h, door.z1), P(leafX, door.h, door.z0)]);
  const leaf = polygonPath([P(leafX, door.h, door.z0), P(leafX, door.h, door.z1), P(leafX, 0, door.z1), P(leafX, 0, door.z0)]);
  // Two raised fields on the leaf, each with a lit and a shaded bevel.
  const field = (y0, y1) => {
    const inset = 12;
    const bevel = 3.2;
    const a = { z0: door.z0 + inset, z1: door.z1 - inset, y0, y1 };
    const outer = [P(leafX, a.y1, a.z0), P(leafX, a.y1, a.z1), P(leafX, a.y0, a.z1), P(leafX, a.y0, a.z0)];
    const inner = [
      P(leafX, a.y1 - bevel, a.z0 + bevel),
      P(leafX, a.y1 - bevel, a.z1 - bevel),
      P(leafX, a.y0 + bevel, a.z1 - bevel),
      P(leafX, a.y0 + bevel, a.z0 + bevel),
    ];
    return {
      face: polygonPath(inner),
      lit: polygonPath([outer[0], outer[1], inner[1], inner[0]]) + polygonPath([outer[0], inner[0], inner[3], outer[3]]),
      shade: polygonPath([outer[1], outer[2], inner[2], inner[1]]) + polygonPath([outer[3], inner[3], inner[2], outer[2]]),
    };
  };
  const fields = [field(112, door.h - 14), field(14, 98)];
  // The lever sits on the near stile, clear of the copy that crosses the leaf.
  const handle = (() => {
    const z = door.z0 + 9;
    const [hx, hy] = P(leafX + 4, 102, z);
    const [ex] = P(leafX + 4, 102, z + 13);
    return { x: hx, y: hy, x2: ex, r: cam.scaleAt(z) * 1.6 };
  })();

  // Skirting along the back wall and the side wall.
  const skirt = 10;
  const backSkirting = polygonPath([P(under, skirt, D), P(900, skirt, D), P(900, 0, D), P(under, 0, D)]);
  const sideSkirting = polygonPath([P(leftX + 1.5, skirt, D), P(leftX + 1.5, skirt, nearZ), P(leftX + 1.5, 0, nearZ), P(leftX + 1.5, 0, D)]);

  // Herringbone oak, 9 x 54 cm planks at 45 degrees.
  const planks = herringbonePlanks({ width: 9, length: 54, xMin: under, xMax: 330, zMin: 330, zMax: D });
  const parquet = floorPaths(cam, planks);

  // The sculptural sconce, 168 cm up the back wall, and its two cones.
  const lampX = 71.5;
  const lampY = 168;
  const [sx, sy] = P(lampX, lampY, D);
  const k = cam.scaleAt(D);
  const body = { x: sx, y: sy, halfW: 6.2 * k, halfH: 15 * k };
  const ceilingY = P(0, H, D)[1];
  const floorY = P(0, 0, D)[1];
  const up = { x: sx, y0: sy - body.halfH, dir: -1, reach: sy - body.halfH - ceilingY, halfWidth: 5.4 * k, knee: 15 * k };
  const down = { x: sx, y0: sy + body.halfH, dir: 1, reach: floorY - sy - body.halfH, halfWidth: 5.4 * k, knee: 17 * k };
  const cone = (spec, spread) => conePath({ ...spec, halfWidth: spec.halfWidth * spread, knee: spec.knee * spread });
  const upTop = coneHalfWidth(up, up.reach);
  const downFoot = coneHalfWidth(down, down.reach);

  return {
    camera: cam,
    corner,
    ceilingY,
    floorY,
    sideWall,
    ceiling,
    floor,
    architrave,
    opening,
    farJamb,
    headJamb,
    leaf,
    fields,
    handle,
    backSkirting,
    sideSkirting,
    parquet,
    lamp: { ...body, wallScale: k },
    cones: {
      up: { halo: cone(up, 1.5), main: cone(up, 1), core: cone(up, 0.52), spec: up, reachY: ceilingY, spread: upTop },
      down: { halo: cone(down, 1.5), main: cone(down, 1), core: cone(down, 0.52), spec: down, reachY: floorY, spread: downFoot },
    },
  };
}

/* ---------- Scene II: 24V recessed track, linear pendant and walnut shelf ---------- */

const GALLERY_ROOM = Object.freeze({ floorY: 812, ceilingY: 96, height: 300, eyeY: 168, depth: 420, vx: 720 });

function buildGallery() {
  const cam = roomCamera(GALLERY_ROOM);
  const { depth: D, height: H } = GALLERY_ROOM;
  const P = (x, y, z) => cam.project(x, y, z);
  const k = cam.scaleAt(D);
  const ceilingY = P(0, H, D)[1];
  const floorY = P(0, 0, D)[1];
  const nearZ = 240;
  const left = (0 - cam.vx) / k;
  const right = (HERO_VIEW.width - cam.vx) / k;

  const ceiling = polygonPath([P(left - 200, H, D), P(right + 200, H, D), P(right + 200, H, nearZ), P(left - 200, H, nearZ)]);
  const floor = polygonPath([P(left - 200, 0, D), P(right + 200, 0, D), P(right + 200, 0, nearZ), P(left - 200, 0, nearZ)]);

  // Limestone cladding: 60 cm courses, 120 cm stones, joints staggered by
  // half a stone each course. Each reveal is a crisp shadow line over a
  // finer lit lip.
  const courses = [];
  for (let y = 60; y < H; y += 60) courses.push(P(0, y, D)[1]);
  const joints = [];
  for (let c = 0; c * 60 < H; c += 1) {
    const offset = c % 2 === 0 ? 0 : 60;
    const yTop = P(0, Math.min(H, (c + 1) * 60), D)[1];
    const yBottom = P(0, c * 60, D)[1];
    for (let x = Math.floor((left - 120 - offset) / 120) * 120 + offset; x <= right + 120; x += 120) {
      joints.push({ x: P(x, 0, D)[0], y0: yTop, y1: yBottom });
    }
  }

  // Slab joints on the travertine floor: lines toward the vanishing point
  // every 90 cm and cross joints every 60 cm of depth.
  const floorLines = [];
  for (let x = Math.floor((left - 300) / 90) * 90; x <= right + 300; x += 90) floorLines.push(polylinePath([P(x, 0, D), P(x, 0, nearZ - 80)]));
  for (let z = D - 60; z > nearZ - 80; z -= 60) floorLines.push(polylinePath([P(left - 400, 0, z), P(right + 400, 0, z)]));

  // The recessed 24V track: a 6 cm slot in the ceiling, 64 cm off the wall.
  const trackZ = D - 64;
  const slot = polygonPath([P(left - 300, H, trackZ - 3), P(right + 300, H, trackZ - 3), P(right + 300, H, trackZ + 3), P(left - 300, H, trackZ + 3)]);
  const slotLip = polylinePath([P(left - 300, H, trackZ - 3), P(right + 300, H, trackZ - 3)]);

  // Two monopoint spots in the slot, each grazing the limestone in a crisp
  // scallop that dies out a metre off the floor.
  const spots = [-236, -64].map((x) => {
    const [px, py] = P(x, H, trackZ);
    const s = cam.scaleAt(trackZ);
    const [wx, wy] = P(x, H - 22, D);
    const reach = P(0, 96, D)[1] - wy;
    return {
      x: px,
      y: py,
      size: s,
      wallX: wx,
      wallY: wy,
      scallop: conePath({ x: wx, y0: wy, dir: 1, reach, halfWidth: 2.6 * k, knee: 9 * k }),
      reach,
    };
  });

  // Travertine console, low and long: an 8 cm slab on a walnut base set back
  // behind a shadow gap. 260 x 46 cm, 44 cm deep.
  const consoleTop = 46;
  const slab = { x0: 0, x1: 260, y0: consoleTop - 8, y1: consoleTop, z0: D - 44, z1: D };
  const plinth = { x0: 26, x1: 234, y0: 0, y1: consoleTop - 8, z0: D - 32, z1: D - 2 };
  const consoleFaces = { slab: projectBox(cam, slab), plinth: projectBox(cam, plinth) };
  const consoleShadow = polygonPath([P(slab.x0 - 2, 0, slab.z0 - 8), P(slab.x1 + 14, 0, slab.z0 - 8), P(slab.x1 + 14, 0, D), P(slab.x0 - 2, 0, D)]);
  const plinthGap = polylinePath([P(plinth.x0, plinth.y1, plinth.z0), P(plinth.x1, plinth.y1, plinth.z0)]);
  // Veins in the travertine, running with the slab across its top and front.
  const veins = [0.24, 0.52, 0.78].map((t, i) =>
    polylinePath(
      Array.from({ length: 11 }, (_, j) => {
        const x = slab.x0 + 4 + (j / 10) * (slab.x1 - slab.x0 - 8);
        const z = slab.z0 + t * (slab.z1 - slab.z0) + Math.sin(j * 1.3 + i * 2.1) * 1.6;
        return P(x, slab.y1, z);
      }),
    ),
  );
  const frontVeins = [0.35, 0.7].map((t, i) =>
    polylinePath(
      Array.from({ length: 11 }, (_, j) => {
        const x = slab.x0 + (j / 10) * (slab.x1 - slab.x0);
        const y = slab.y0 + t * (slab.y1 - slab.y0) + Math.sin(j * 1.7 + i) * 0.6;
        return P(x, y, slab.z0);
      }),
    ),
  );
  const objects = (() => {
    const urn = P(214, consoleTop, D - 22);
    const bowl = P(150, consoleTop, D - 20);
    return { urn: { x: urn[0], y: urn[1], s: cam.scaleAt(D - 22) }, bowl: { x: bowl[0], y: bowl[1], s: cam.scaleAt(D - 20) } };
  })();

  // Floating walnut shelf, 110 x 7 cm and 26 cm deep, top 122 cm off the
  // floor, to the right of the pendant.
  const shelfBox = { x0: 214, x1: 324, y0: 115, y1: 122, z0: D - 26, z1: D };
  const shelf = projectBox(cam, shelfBox);
  const shelfLed = polylinePath([P(shelfBox.x0 + 4, shelfBox.y0, D - 21), P(shelfBox.x1 - 4, shelfBox.y0, D - 21)]);
  const shelfShadow = polygonPath([
    P(shelfBox.x0 + 6, shelfBox.y0, D),
    P(shelfBox.x1 - 2, shelfBox.y0, D),
    P(shelfBox.x1 + 6, shelfBox.y0 - 8, D),
    P(shelfBox.x0 + 14, shelfBox.y0 - 8, D),
  ]);
  // The under-shelf wash: a golden trapezoid down the limestone to the floor.
  const washTop = P(0, shelfBox.y0, D)[1];
  const washFoot = P(0, 0, D)[1];
  const wash = polygonPath([
    P(shelfBox.x0 + 5, shelfBox.y0, D),
    P(shelfBox.x1 - 5, shelfBox.y0, D),
    P(shelfBox.x1 + 34, 0, D),
    P(shelfBox.x0 - 34, 0, D),
  ]);
  // Styling on the shelf: three art books standing, two lying, a ceramic vase.
  const books = [
    { x0: 226, x1: 229.5, h: 27, tone: 'linen' },
    { x0: 229.5, x1: 232.5, h: 24, tone: 'clay' },
    { x0: 232.5, x1: 236.5, h: 29, tone: 'ink' },
  ].map((b) => ({ ...b, faces: projectBox(cam, { x0: b.x0, x1: b.x1, y0: shelfBox.y1, y1: shelfBox.y1 + b.h, z0: D - 22, z1: D - 4 }) }));
  const stack = [
    { y0: 0, y1: 3.2, x0: 258, x1: 288, tone: 'linen' },
    { y0: 3.2, y1: 5.6, x0: 261, x1: 286, tone: 'ink' },
  ].map((b) => ({ ...b, faces: projectBox(cam, { x0: b.x0, x1: b.x1, y0: shelfBox.y1 + b.y0, y1: shelfBox.y1 + b.y1, z0: D - 21, z1: D - 3 }) }));
  const vaseBase = P(308, shelfBox.y1, D - 13);
  const vase = { x: vaseBase[0], y: vaseBase[1], s: cam.scaleAt(D - 13) };

  // The linear pendant: 130 cm of matte anodized aluminium on two cables
  // from the track, hung just above eye level so its lit diffuser shows.
  const pendantZ = trackZ;
  const pendant = (() => {
    const x0 = 34;
    const x1 = 164;
    const y = 176;
    const box = projectBox(cam, { x0, x1, y0: y, y1: y + 4.5, z0: pendantZ - 3, z1: pendantZ + 3 });
    const cables = [x0 + 12, x1 - 12].map((x) => [P(x, H, pendantZ), P(x, y + 4.5, pendantZ)]);
    // The beam: from the diffuser down to the console top, landing as a pool.
    const beam = polygonPath([P(x0 + 2, y, pendantZ - 3), P(x1 - 2, y, pendantZ - 3), P(x1 + 22, consoleTop, pendantZ + 12), P(x0 - 22, consoleTop, pendantZ + 12)]);
    const poolCentre = P((x0 + x1) / 2, consoleTop, D - 22);
    const poolEdge = P(x1 + 20, consoleTop, D - 22);
    const poolDepth = P((x0 + x1) / 2, consoleTop, D - 2);
    // On the wall behind, the beam's spill: a soft glow over the console.
    const [wx, wy] = P((x0 + x1) / 2, consoleTop + 30, D);
    return {
      box,
      cables,
      beam,
      beamTop: P(0, y, pendantZ)[1],
      pool: { x: poolCentre[0], y: poolCentre[1], rx: poolEdge[0] - poolCentre[0], ry: Math.max(6, poolDepth[1] - poolCentre[1]) },
      wallSpill: { x: wx, y: wy },
    };
  })();

  return {
    camera: cam,
    wallScale: k,
    ceilingY,
    floorY,
    ceiling,
    floor,
    courses,
    joints,
    floorLines,
    slot,
    slotLip,
    trackY: P(0, H, trackZ)[1],
    spots,
    shelf,
    shelfLed,
    shelfShadow,
    wash,
    washTop,
    washFoot,
    books,
    stack,
    vase,
    consoleTopY: P(0, consoleTop, D - 44)[1],
    consoleFaces,
    consoleShadow,
    plinthGap,
    veins,
    frontVeins,
    objects,
    pendant,
  };
}

let cache = null;

/** Both scenes, built once per load: the geometry never changes after that. */
export function heroSceneGeometry() {
  if (!cache) cache = Object.freeze({ wallWash: buildWallWash(), gallery: buildGallery() });
  return cache;
}
