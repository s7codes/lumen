import * as THREE from 'three';
import { engineModules, moduleGroup } from '../parts.js';
import { skyTexture } from '../pt.js';

/** Sky for the windows and the bounces. */
export function daylight(scene, { scale = 1.5, env = 0.6 } = {}) {
  const sky = skyTexture({ scale });
  scene.environment = sky;
  scene.background = sky;
  scene.userData.envIntensity = env;
  scene.userData.backgroundIntensity = 1;
}

/** Engine modules for a room, each added with its own light group. */
export function placeModules(scene, room, specs) {
  const modules = engineModules(specs.map((s) => ({ productId: s.productId, finish: s.finish, xCm: s.xCm, yCm: s.yCm, wall: s.wall, uid: s.uid })), room);
  return modules.map((module, i) => {
    const spec = specs[i];
    const group = moduleGroup(module, { group: spec.group ?? 'led', standoff: spec.standoff ?? 0, level: spec.level ?? 1 });
    if (spec.move || spec.turn) {
      // Re-hang a part away from its wall: pivot about its own centre.
      const b = module.box;
      const cx = (b.x0 + b.x1) / 200;
      const cz = (b.z0 + b.z1) / 200;
      const pivot = new THREE.Group();
      pivot.position.set(spec.move?.[0] ?? cx, 0, spec.move?.[1] ?? cz);
      group.position.set(-cx, 0, -cz);
      pivot.add(group);
      pivot.rotation.y = spec.turn ?? 0;
      scene.add(pivot);
    } else {
      scene.add(group);
    }
    return { module, group };
  });
}
