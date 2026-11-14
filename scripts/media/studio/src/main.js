import { resetUvSeed } from './geometry.js';
import { projectPoints, renderGuides, renderPasses } from './pt.js';
import { productShot } from './scenes/product.js';

/*
 * Lumen media studio. The driver (render.mjs) calls window.studio.run(job)
 * per shot; every pass is posted back as linear float RGB.
 */

const status = document.createElement('pre');
document.body.appendChild(status);

const BUILDERS = {
  product: (job) => productShot(job.productId, job.finish, job),
};

async function loadScene(kind) {
  if (BUILDERS[kind]) return BUILDERS[kind];
  const mod = await import(`./scenes/${kind}.js`);
  BUILDERS[kind] = mod.default;
  return mod.default;
}

window.studio = {
  async run(job) {
    resetUvSeed(job.seed ?? 1);
    const build = await loadScene(job.kind);
    const shot = build(job);
    const width = job.width;
    const height = job.height;
    shot.camera.aspect = width / height;
    if (job.guidesOnly) {
      await renderGuides({ shot: job.id, scene: shot.scene, camera: shot.camera, width, height });
      return { results: [], meta: shot.meta ?? {}, anchors: [], guides: true };
    }
    const passes = shot.passes
      .filter((pass) => !job.only || job.only.includes(pass.name))
      .map((pass) => ({ ...pass, spp: Math.round((job.sppScale ?? 1) * pass.spp) }));
    const results = await renderPasses({
      shot: job.id,
      scene: shot.scene,
      camera: shot.camera,
      width,
      height,
      passes,
      onStatus: (text) => {
        status.textContent = text;
        document.title = text;
      },
    });
    await renderGuides({ shot: job.id, scene: shot.scene, camera: shot.camera, width, height });
    const anchors = shot.anchors ? projectPoints(shot.camera, shot.anchors) : [];
    return { results, meta: shot.meta ?? {}, anchors, camera: { matrixWorld: shot.camera.matrixWorld.elements, projection: shot.camera.projectionMatrix.elements } };
  },
};
document.title = 'ready';
