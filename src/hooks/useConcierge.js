import { useCallback, useMemo, useReducer, useRef } from 'react';
import { askConcierge, submitSupportTicket } from '../api/client.js';
import { loadBag } from '../lib/bag.js';
import {
  conciergeReducer,
  createConciergeSession,
  describeWorkspace,
  ESCALATION_LOCKED,
  ESCALATION_UNLOCKED,
  escalationTranscript,
  evaluateConciergeQuery,
  quickPromptsFor,
  sanitizeQuestion,
} from '../lib/concierge-engine.js';
import { getCurrencyCode } from '../lib/currency-store.js';
import { loadRoomState, serializeRoomState } from '../lib/room-3d.js';
import { loadLayout, serializeLayout } from '../lib/wall-studio.js';

/**
 * Live workspace snapshot for the concierge, read at question time from the
 * same storage the planners and the bag write on every committed change.
 */
export function readWorkspaceContext(route) {
  return {
    route,
    currency: getCurrencyCode(),
    wallDraft: serializeLayout(loadLayout()),
    roomDraft: serializeRoomState(loadRoomState()),
    bagItems: loadBag(),
  };
}

/**
 * Studio AI concierge session: the conversation, the escalation gatekeeper
 * and the ticket it may issue. The state machine lives in
 * concierge-engine.js; this hook only feeds it replies and workspace reads.
 */
export function useConcierge(route) {
  const [state, dispatch] = useReducer(conciergeReducer, undefined, createConciergeSession);
  const stateRef = useRef(state);
  stateRef.current = state;
  const routeRef = useRef(route);
  routeRef.current = route;
  // Bumped by a new chat: a reply still in flight from the old thread is dropped,
  // never accepted as the answer to the next question.
  const generationRef = useRef(0);

  const ask = useCallback(async (question) => {
    const text = sanitizeQuestion(question);
    if (!text || stateRef.current.pending) return false;
    const generation = generationRef.current;
    const current = (action) => {
      if (generation === generationRef.current) dispatch(action);
    };
    dispatch({ type: 'ask', question: text });
    const context = readWorkspaceContext(routeRef.current);
    try {
      const { reply, transport } = await askConcierge(text, context);
      current({ type: 'reply', reply, transport });
    } catch {
      // askConcierge already answers locally on every transport fault; this is
      // the last net, and a server message never reaches the conversation.
      try {
        current({ type: 'reply', reply: evaluateConciergeQuery(text, context), transport: 'local' });
      } catch {
        current({ type: 'fail', message: 'The concierge could not answer. Ask again.' });
      }
    }
    return true;
  }, []);

  /** New chat: a fresh session with the gatekeeper locked again. */
  const reset = useCallback(() => {
    generationRef.current += 1;
    dispatch({ type: 'reset' });
  }, []);

  const markUnhelpful = useCallback((turnId) => {
    dispatch({ type: 'mark-unhelpful', turnId, context: readWorkspaceContext(routeRef.current) });
  }, []);

  /** Sends the ticket with the transcript and workspace digest. Resolves with `{ ticket, transport }`. */
  const submitTicket = useCallback(async ({ email, subject, message }) => {
    const current = stateRef.current;
    const context = readWorkspaceContext(routeRef.current);
    const result = await submitSupportTicket({
      email,
      subject,
      message,
      reason: current.escalation.reason,
      transcript: escalationTranscript(current),
      workspaceSummary: describeWorkspace(context),
    });
    dispatch({ type: 'ticket', ticket: { ...result.ticket, transport: result.transport } });
    return result;
  }, []);

  const quickPrompts = useMemo(() => quickPromptsFor(route), [route]);
  const workspaceSummary = useMemo(
    () => (state.escalation.unlocked ? describeWorkspace(readWorkspaceContext(route)) : ''),
    // Re-read when the gate opens or a new turn lands, not on every render.
    [state.escalation.unlocked, state.turns.length, route],
  );
  const inquiry = useMemo(() => {
    const turn = state.turns.find((entry) => entry.id === state.escalation.turnId);
    return turn?.reply?.question ?? '';
  }, [state.turns, state.escalation.turnId]);

  return {
    turns: state.turns,
    pending: state.pending,
    fault: state.fault,
    ticket: state.ticket,
    escalation: state.escalation.unlocked ? ESCALATION_UNLOCKED : ESCALATION_LOCKED,
    escalationReason: state.escalation.reason,
    inquiry,
    workspaceSummary,
    quickPrompts,
    ask,
    reset,
    markUnhelpful,
    submitTicket,
  };
}
