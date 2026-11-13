import { persistBag } from './bag.js';
import { sanitizeClientActions } from './concierge-engine.js';
import { persistRoomState } from './room-3d.js';
import { persistLayout } from './wall-studio.js';
import { emitWorkspaceMutation } from './workspace-events.js';

export { subscribeWorkspaceMutations, WORKSPACE_MUTATE_EVENT } from './workspace-events.js';

/**
 * Agentic workspace execution bus. Applies the `clientActions` an MCP
 * mutation tool returned:
 *
 * - `apply_room_state`  the 3D room, plus an optional active wall, camera
 *                       lens and module to select
 * - `apply_wall_state`  the 2D Wall Studio layout
 * - `apply_bag_items`   the cart lines
 *
 * Each action is rebuilt through its canonical sanitizer, written to the
 * same storage the planners and the cart read, then announced on the window.
 * A mounted planner turns the announcement into one undoable history step;
 * an unmounted one simply opens on the stored result. Returns the actions
 * that were applied.
 */
export function executeClientActions(clientActions) {
  const applied = [];
  for (const action of sanitizeClientActions(clientActions)) {
    let stored = false;
    if (action.type === 'apply_room_state') stored = persistRoomState(action.state);
    else if (action.type === 'apply_wall_state') stored = persistLayout(action.state);
    else if (action.type === 'apply_bag_items') stored = persistBag(action.items);
    // Without storage (a private window) the live planner still takes the change.
    emitWorkspaceMutation(action);
    applied.push({ ...action, stored: stored !== false });
  }
  return applied;
}
