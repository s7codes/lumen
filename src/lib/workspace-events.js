/**
 * The window event that carries an agentic workspace mutation from Lumen AI
 * to whichever planner or provider is mounted. Kept free of any engine import
 * so the entry bundle (the cart provider) can listen without loading the
 * concierge. Actions are emitted by workspace-bus.js after sanitizing and
 * persisting them; listeners still rebuild every state they apply.
 */

export const WORKSPACE_MUTATE_EVENT = 'lumen:workspace-mutate';

const ACTION_TYPES = new Set(['apply_room_state', 'apply_wall_state', 'apply_bag_items']);

export function emitWorkspaceMutation(action) {
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_MUTATE_EVENT, { detail: action }));
}

/**
 * Calls `listener(action)` for every mutation, or only for `types` when
 * given. Returns the unsubscribe function, so it drops into a useEffect.
 */
export function subscribeWorkspaceMutations(listener, types = null) {
  if (typeof window === 'undefined') return () => {};
  const onMutate = (event) => {
    const action = event?.detail;
    if (!action || typeof action !== 'object' || !ACTION_TYPES.has(action.type)) return;
    if (types && !types.includes(action.type)) return;
    listener(action);
  };
  window.addEventListener(WORKSPACE_MUTATE_EVENT, onMutate);
  return () => window.removeEventListener(WORKSPACE_MUTATE_EVENT, onMutate);
}
