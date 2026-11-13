import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { TICKET_OUTBOX_STORAGE_KEY } from '../src/api/client.js';
import { getProduct } from '../src/data/products.js';
import { BAG_STORAGE_KEY } from '../src/lib/bag.js';
import { computeBusTopology } from '../src/lib/bus-topology.js';
import { TICKET_QUEUED, TICKET_REF_PATTERN } from '../src/lib/cloud-records.js';
import {
  canMarkUnhelpful,
  composeFollowUp,
  conciergeReducer,
  CONTACT_GATE_REPLY,
  createConciergeSession,
  describeWorkspace,
  ESCALATION_NOTICE,
  escalationTranscript,
  evaluateConciergeQuery,
  GATEKEEPER_LOCKED_MESSAGE,
  noiseReductionCoefficient,
  quickPromptsFor,
  RESOLVED_CONFIDENCE,
  UNRESOLVED_CONFIDENCE,
  validateEscalationRequest,
  validateWorkspaceContext,
  verifyEscalationTranscript,
} from '../src/lib/concierge-engine.js';
import { maxRunM } from '../src/lib/electrical.js';
import { runDeterministicAgent } from '../src/lib/mcp-orchestrator.js';
import { formatInt } from '../src/lib/format.js';
import { buildQuote } from '../src/lib/quote.js';
import { createRoomState, findRoomConflicts, mountInRoom, ROOM_STORAGE_KEY, serializeRoomState, unrolledRoom, wallCounts } from '../src/lib/room-3d.js';
import { computeEnvironmentalPhysics } from '../src/lib/room-physics.js';
import { layoutFromPreset, serializeLayout, summarizeWall, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

// Test value for the local API under test; the server only length-checks it.
const TEST_PASSWORD = 'nordic-test-0042';
const LOCKED_COPY = 'Direct engineering contact is locked while Studio AI handles your questions.';
const UNHELPFUL_COPY = 'Did not resolve my issue - request engineer';
const OPEN_3D = 'Why cant I open 3D room designer';
const LAUNCH_ACTIONS = [
  { label: 'Launch 3D Spatial Studio', to: '/room-3d' },
  { label: 'Launch 165 cm Walkthrough', to: '/room-3d?lens=inside' },
];
const BESPOKE = 'Can you fabricate a custom 480 cm curved marble beam with onsite structural welding?';
const SHELF_PROMPT = 'Floating Shelf 110 specs & anchors';
const DRIVER_PROMPT = 'Compare 60W vs 150W 24V drivers';

/* Fixtures: a populated wall, a four-wall room and a cart. */

const WALL = layoutFromPreset('nordic-reading-wall');

function buildRoom() {
  let state = createRoomState({ widthCm: 480, depthCm: 420, heightCm: 270 });
  for (const [productId, wall] of [
    ['floating-shelf-110', 'north'],
    ['linear-pendant-150', 'north'],
    ['acoustic-baffle-120', 'east'],
    ['acoustic-art-frame-50x70', 'south'],
    ['wall-sconce-80', 'west'],
  ]) {
    state = mountInRoom(state, productId, wall).state;
  }
  return state;
}

const ROOM = buildRoom();
const BAG = [
  { id: 'floating-shelf-110', finish: 'walnut', qty: 2 },
  { id: 'acoustic-baffle-120', finish: 'oak', qty: 1 },
  { id: 'track-bus-200', finish: 'obsidian', qty: 1 },
];

function context(route, extra = {}) {
  return { route, currency: 'USD', wallDraft: serializeLayout(WALL), roomDraft: serializeRoomState(ROOM), bagItems: BAG, ...extra };
}

function guestNamespace() {
  return `e2e-${randomUUID().replaceAll('-', '')}`;
}

function uniqueEmail(tag) {
  return `${tag}-${randomUUID().slice(0, 8)}@lumen-e2e.com`;
}

function isApiCall(method, path) {
  return (request) => request.method() === method && new URL(request.url()).pathname === path;
}

async function signIn(page, email) {
  await page.getByRole('banner').getByRole('button', { name: 'Sign In' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in' });
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Password').fill(TEST_PASSWORD);
  const [call] = await Promise.all([
    page.waitForRequest(isApiCall('POST', '/api/auth/session')),
    dialog.getByRole('button', { name: 'Sign In' }).click(),
  ]);
  expect((await call.response()).status()).toBe(201);
  await expect(dialog).toBeHidden();
}

async function openConcierge(page) {
  await page.getByTestId('concierge-trigger').click();
  const panel = page.getByTestId('concierge-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(page, question) {
  const replies = page.getByTestId('concierge-reply');
  const before = await replies.count();
  await page.getByTestId('concierge-input').fill(question);
  await page.getByTestId('concierge-send').click();
  await expect(replies).toHaveCount(before + 1);
  await expect(page.getByTestId('concierge-panel')).toHaveAttribute('data-state', 'idle');
  // By index, not last(): a follow-up turn may land after this reply.
  return replies.nth(before);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

/* Engine: pure, deterministic, shared by the browser and server/app.js */

test.describe('concierge engine and live workspace RAG', () => {
  test('answers catalog, 24V electrical and acoustic questions from the canonical data', () => {
    const shelf = evaluateConciergeQuery(SHELF_PROMPT, { route: '/catalog' });
    expect(shelf).toMatchObject({ category: 'catalog', resolved: true, question: SHELF_PROMPT });
    expect(shelf.confidence).toBeGreaterThanOrEqual(RESOLVED_CONFIDENCE);
    expect(shelf.id).toMatch(/^LMN-C-[0-9A-F]{8}$/);
    for (const fact of ['LMN-SH-110', '110 x 8 x 25 cm', '6.8 kg', '3 anchor points', '1,150 lm', '2700K', 'CRI 97', 'USD 185.00']) {
      expect(shelf.answer).toContain(fact);
    }
    expect(shelf.metrics).toContainEqual({ label: 'Anchors', value: '3' });
    expect(shelf.suggestedActions).toContainEqual({ label: 'View Floating Shelf 110', to: '/catalog/floating-shelf-110' });
    expect(shelf.citations).toContainEqual({ id: 'catalog:floating-shelf-110', label: 'Catalog / LMN-SH-110 Floating Shelf 110' });
    expect(canMarkUnhelpful(shelf)).toBe(true);

    const drivers = evaluateConciergeQuery(DRIVER_PROMPT);
    expect(drivers).toMatchObject({ category: 'electrical', resolved: true });
    expect(drivers.answer).toContain('Lumen 60W 24V Driver (LMN-DR-060): USD 58.00');
    expect(drivers.answer).toContain('Lumen 150W 24V Driver (LMN-DR-150): USD 112.00');
    expect(drivers.answer).toContain('under 3% (0.72 V) over a 2 x 2.5 mm2 copper loop');
    expect(drivers.answer).toContain('48 W on the 60W, 120 W on the 150W');
    expect(drivers.metrics).toContainEqual({ label: '150W Driver', value: 'USD 112.00' });
    // Prices follow the active currency at the catalog's fixed ratios.
    const huf = evaluateConciergeQuery(DRIVER_PROMPT, { currency: 'HUF' });
    expect(huf.answer).toContain('HUF 40,320');

    const drop = evaluateConciergeQuery('What is the max voltage drop over 2.5 mm2 copper?');
    expect(drop.category).toBe('electrical');
    expect(drop.answer).toContain(`150 W ${maxRunM(150).toFixed(1)} m`);

    const acoustics = evaluateConciergeQuery('How do RT60 and STI work for speech?');
    expect(acoustics).toMatchObject({ category: 'physics', resolved: true });
    expect(acoustics.answer).toContain('RT60 = 0.161 V / (A + 4mV)');
    expect(acoustics.answer).toContain('NRC 0.85');
    expect(noiseReductionCoefficient(getProduct('acoustic-baffle-120'))).toBe(0.85);
    expect(noiseReductionCoefficient(getProduct('acoustic-art-frame-50x70'))).toBe(0.7);
    expect(noiseReductionCoefficient(getProduct('floating-shelf-110'))).toBeNull();

    const scenes = evaluateConciergeQuery('Explain the DALI-2 dimming scenes');
    expect(scenes.answer).toContain('10% to 100% in 5% steps');
    expect(scenes.answer).toContain('Night Gallery: task 20% / accent 40%');

    const split = evaluateConciergeQuery('Explain Split Rough-In shipping');
    expect(split).toMatchObject({ category: 'commerce', resolved: true });
    expect(split.answer).toContain('Rough-In & In-Stock Dispatch');
  });

  test('reads the live wall, room and cart with the same engines the planners and checkout use', () => {
    const wallReply = evaluateConciergeQuery('How many watts is my wall using?', context('/studio-2d'));
    const summary = summarizeWall(WALL);
    const wallBus = computeBusTopology(WALL);
    expect(wallReply).toMatchObject({ category: 'workspace', resolved: true });
    expect(wallReply.answer).toContain(`carries ${summary.modules} modules`);
    expect(wallReply.answer).toContain(`Rated 24V load ${summary.loadW} W`);
    expect(wallReply.answer).toContain(summary.psu.label);
    expect(wallReply.answer).toContain(`${wallBus.voltageDropPct.toFixed(2)}% (${wallBus.voltageDropV.toFixed(2)} V) drop`);
    expect(wallReply.metrics).toContainEqual({ label: 'Modules', value: String(summary.modules) });
    expect(wallReply.metrics).toContainEqual({ label: 'Rated Load', value: `${summary.loadW} W` });
    expect(wallReply.citations.map((cite) => cite.id)).toContain('workspace:wall');

    const audit = evaluateConciergeQuery('Audit my live 3D room & RT60', context('/room-3d'));
    const counts = wallCounts(ROOM.items);
    const physics = computeEnvironmentalPhysics(ROOM);
    const roomBus = computeBusTopology(unrolledRoom(ROOM));
    const roomSummary = summarizeWall(ROOM);
    expect(audit).toMatchObject({ category: 'workspace', resolved: true });
    expect(audit.answer).toContain(`North ${counts.north} / East ${counts.east} / South ${counts.south} / West ${counts.west}`);
    expect(audit.answer).toContain(`Rated 24V load ${roomSummary.loadW} W`);
    expect(audit.answer).toContain(`${roomBus.totalRunM.toFixed(2)} m`);
    expect(audit.answer).toContain(`Sabine RT60 is ${physics.rt60Sec.toFixed(2)} s at 500 Hz`);
    expect(audit.answer).toContain(`STI ${physics.stiScore.toFixed(2)} (${physics.stiGrade})`);
    expect(audit.answer).toContain(`Average floor illuminance ${formatInt(physics.avgFloorLux)} lx`);
    expect(audit.answer).toContain(findRoomConflicts(ROOM).size === 0 ? 'No placement conflicts.' : 'in conflict');
    expect(audit.metrics).toContainEqual({ label: 'RT60', value: `${physics.rt60Sec.toFixed(2)} s` });
    expect(audit.suggestedActions[0]).toEqual({ label: 'Open 3D Spatial Studio', to: '/room-3d' });

    const room = evaluateConciergeQuery('What is my room RT60 or illuminance?', context('/'));
    expect(room.answer).toContain(`Sabine RT60 is ${physics.rt60Sec.toFixed(2)} s`);
    expect(room.answer).not.toContain('Rated 24V load');

    const driver = evaluateConciergeQuery('Which PSU driver do I need?', context('/studio-2d'));
    expect(driver.category).toBe('workspace');
    expect(driver.answer).toContain(`${summary.psu.label} at ${Math.round(summary.psu.utilisation * 100)}% utilisation`);

    const quote = buildQuote({ items: BAG, currencyCode: 'USD' });
    const crates = evaluateConciergeQuery('How many crates will my cart ship in?', context('/'));
    expect(crates.category).toBe('workspace');
    expect(crates.answer).toContain(`ships in ${quote.logistics.crates.length} crates`);
    for (const crate of quote.logistics.crates) expect(crates.answer).toContain(crate.code);
    expect(crates.metrics).toContainEqual({ label: 'Crates', value: String(quote.logistics.crates.length) });

    // An empty workspace is answered, not escalated.
    const empty = evaluateConciergeQuery('Audit my live 3D room & RT60', { route: '/room-3d' });
    expect(empty).toMatchObject({ category: 'workspace', resolved: true });
    expect(empty.answer).toContain('Your 3D room has no modules mounted yet.');

    const digest = describeWorkspace(context('/room-3d'));
    expect(digest.length).toBeLessThanOrEqual(600);
    expect(digest).toContain(`RT60 ${physics.rt60Sec.toFixed(2)} s`);
    expect(digest).toContain(`2D wall ${WALL.wall.widthCm} x ${WALL.wall.heightCm} cm: ${summary.modules} modules`);
  });

  test('every starter answer is one lead sentence and two to four labelled bullets, within 65 words', () => {
    const words = (text) => text.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;
    for (const route of ['/', '/room-3d', '/studio-2d', '/catalog', '/checkout', '/account', '/catalog/linear-pendant-150']) {
      for (const question of quickPromptsFor(route)) {
        const label = `${route} ${question}`;
        const reply = evaluateConciergeQuery(question, context(route));
        const [body, ...notes] = reply.answer.split('\n\n');
        const [lead, ...bullets] = body.split('\n');
        expect(lead, label).toMatch(/^[A-Z0-9].*[.:]$/);
        expect(bullets.length, label).toBeGreaterThanOrEqual(2);
        expect(bullets.length, label).toBeLessThanOrEqual(4);
        for (const line of bullets) expect(line, label).toMatch(/^- \S/);
        expect(notes, label).toEqual([]);
        expect(words(reply.answer), label).toBeLessThanOrEqual(65);
        expect(reply.metrics.length, label).toBeLessThanOrEqual(4);
      }
    }
    // Bullets open with a short label the panel sets in bold.
    const audit = evaluateConciergeQuery('Audit my live 3D room & RT60', context('/room-3d'));
    expect(audit.answer.split('\n').slice(1).map((line) => line.slice(2).split(': ')[0])).toEqual(['Power', 'Acoustics', 'Light', 'Layout']);
    // One figure asked, one figure answered: a bare "check" stays on the voltage drop.
    const drop = evaluateConciergeQuery('Check my wall voltage drop', context('/studio-2d'));
    expect(drop.answer.split('\n').slice(1).map((line) => line.slice(2).split(': ')[0])).toEqual(['Load', 'Bus']);
    // An escalation keeps its lead and bullet, then closes on the unchanged notice.
    const [head, notice] = evaluateConciergeQuery(BESPOKE).answer.split('\n\n');
    expect(head).toMatch(/^Outside automated scope: bespoke fabrication, .+\.\n- Automated scope: /);
    expect(notice).toBe(ESCALATION_NOTICE);
  });

  test('routes bespoke, structural, onsite, freight, invoicing and off-topic inquiries to studio engineering', () => {
    const bespoke = evaluateConciergeQuery(BESPOKE);
    expect(bespoke).toMatchObject({ category: 'engineering', resolved: false });
    expect(bespoke.confidence).toBeLessThan(UNRESOLVED_CONFIDENCE);
    expect(bespoke.answer.endsWith(ESCALATION_NOTICE)).toBe(true);
    expect(canMarkUnhelpful(bespoke)).toBe(false);

    for (const question of [
      'Is the 24V bus certified for a bathroom wet zone?',
      'Can the floating shelf carry load on a load-bearing masonry wall?',
      'Book an installer crew for Friday',
      'My crate arrived damaged, I need a refund',
      'Can you invoice our enterprise on net 30 terms?',
      'What is the weather in Budapest?',
    ]) {
      const reply = evaluateConciergeQuery(question);
      expect(reply.resolved, question).toBe(false);
      expect(reply.confidence, question).toBeLessThan(UNRESOLVED_CONFIDENCE);
      expect(reply.answer, question).toContain(ESCALATION_NOTICE);
    }

    // Planner and catalog vocabulary never reads as bespoke or onsite work.
    for (const question of [
      'Can I customize the DALI scenes?',
      'Does my electrician need anything special for the 24V bus?',
      'Can the track be cut on site to 150 cm?',
      'What ships in the Custom Millwork & Luminaires wave?',
      'Lead times for made-to-order parts',
    ]) {
      const reply = evaluateConciergeQuery(question);
      expect(reply.resolved, question).toBe(true);
      expect(reply.confidence, question).toBeGreaterThanOrEqual(RESOLVED_CONFIDENCE);
    }

    // Asking for a human is handled, never escalated by itself.
    for (const question of ['I want to contact human support', 'Email human agent']) {
      const reply = evaluateConciergeQuery(question);
      expect(reply).toMatchObject({ category: 'gatekeeper', resolved: true, answer: CONTACT_GATE_REPLY });
      expect(canMarkUnhelpful(reply)).toBe(false);
    }
  });

  test('is deterministic, decided by the question alone, and survives hostile input', () => {
    const ctx = context('/room-3d', { currency: 'EUR' });
    expect(evaluateConciergeQuery('Audit my live 3D room & RT60', ctx)).toEqual(
      evaluateConciergeQuery('Audit my live 3D room & RT60', structuredClone(ctx)),
    );
    // The server replays transcripts without the visitor's drafts: the verdict must not move.
    for (const question of [...quickPromptsFor('/room-3d'), ...quickPromptsFor('/checkout'), BESPOKE, 'Email human agent']) {
      const live = evaluateConciergeQuery(question, ctx);
      const replay = evaluateConciergeQuery(question);
      expect({ resolved: replay.resolved, category: replay.category }, question).toEqual({
        resolved: live.resolved,
        category: live.category,
      });
    }

    const hostile = evaluateConciergeQuery(`\u0000\u0007${'rt60 '.repeat(2000)}`, { route: 'javascript:alert(1)' });
    expect(hostile.question.length).toBeLessThanOrEqual(500);
    expect(hostile.question).not.toMatch(/[\u0000-\u001f]/);
    expect(hostile.resolved).toBe(true);

    const polluted = JSON.parse('{"__proto__":{"polluted":1},"route":"/room-3d","wallDraft":{"format":"evil"},"bagItems":[{"id":"constructor","finish":"oak","qty":1}]}');
    const reply = evaluateConciergeQuery('Audit my live 3D room & RT60', polluted);
    expect(reply.answer).toContain('Your 3D room has no modules mounted yet.');
    expect({}.polluted).toBeUndefined();
    expect(validateWorkspaceContext({ wallDraft: { format: 'evil', items: [] } }).error).toMatch(/wallDraft/);
    expect(validateWorkspaceContext({ bagItems: [{ id: 'constructor', finish: 'oak', qty: 1 }] }).error).toMatch(/bagItems/);
    expect(validateWorkspaceContext({ route: '//evil.example' }).error).toMatch(/route/);
    expect(validateWorkspaceContext(context('/room-3d')).error).toBeNull();
  });

  test('gatekeeper state machine: contact requests stay locked; unresolved or unhelpful turns unlock', () => {
    const answer = (state, question) =>
      conciergeReducer(conciergeReducer(state, { type: 'ask', question }), {
        type: 'reply',
        reply: evaluateConciergeQuery(question),
      });

    let state = answer(createConciergeSession(), 'I want to contact human support');
    expect(state.escalation).toEqual({ unlocked: false, reason: null, turnId: null });
    const gateTurn = state.turns.at(-1);
    // The gate reply cannot be marked unhelpful: there is no answer to reject.
    expect(conciergeReducer(state, { type: 'mark-unhelpful', turnId: gateTurn.id })).toBe(state);
    // A ticket cannot be attached while locked.
    expect(conciergeReducer(state, { type: 'ticket', ticket: { ref: 'LMN-T-00000000' } })).toBe(state);

    state = answer(state, SHELF_PROMPT);
    expect(state.escalation.unlocked).toBe(false);
    const shelfTurn = state.turns.at(-1);
    const marked = conciergeReducer(state, { type: 'mark-unhelpful', turnId: shelfTurn.id, context: context('/catalog') });
    expect(marked.escalation).toEqual({ unlocked: true, reason: 'marked_unhelpful', turnId: shelfTurn.id });
    expect(marked.turns.at(-2).markedUnhelpful).toBe(true);
    expect(marked.turns.at(-1)).toMatchObject({ role: 'assistant', kind: 'followup' });
    expect(marked.turns.at(-1).reply.answer).toBe(composeFollowUp(SHELF_PROMPT, context('/catalog')).answer);
    expect(conciergeReducer(marked, { type: 'mark-unhelpful', turnId: shelfTurn.id })).toBe(marked);

    const unresolved = answer(state, BESPOKE);
    expect(unresolved.escalation).toMatchObject({ unlocked: true, reason: 'unresolved_query' });

    // The unlocking turn stays pinned in the transcript past the 24-turn cap.
    let long = unresolved;
    for (let i = 0; i < 30; i += 1) long = answer(long, DRIVER_PROMPT);
    const transcript = escalationTranscript(long);
    expect(transcript).toHaveLength(24);
    expect(transcript[0]).toMatchObject({ question: BESPOKE, resolved: false });
    expect(verifyEscalationTranscript(transcript).reasons).toEqual(['unresolved_query']);

    // Forged flags the engine does not reproduce are ignored.
    expect(verifyEscalationTranscript([{ question: SHELF_PROMPT, resolved: false }]).reasons).toEqual([]);
    expect(verifyEscalationTranscript([{ question: 'Email human agent', resolved: true, markedUnhelpful: true }]).reasons).toEqual([]);
    expect(verifyEscalationTranscript([{ question: SHELF_PROMPT, resolved: true, markedUnhelpful: true }]).reasons).toEqual([
      'marked_unhelpful',
    ]);
    const request = { email: 'studio@lumen.com', subject: 'Curved beam', message: 'Need a 480 cm marble beam on site.', reason: 'unresolved_query' };
    expect(validateEscalationRequest({ ...request, transcript: [] })).toMatchObject({ ok: false, code: 'gatekeeper_locked' });
    expect(validateEscalationRequest({ ...request, transcript })).toMatchObject({ ok: true, ticket: { inquiry: BESPOKE, turns: 24 } });
  });
});

/* Server: POST /api/concierge/ask, POST /api/concierge/escalate, GET /api/tickets */

test.describe('server concierge API', () => {
  test('POST /api/concierge/ask answers with the shared engine and refuses tampered payloads', async ({ request }) => {
    // The MCP pipeline keeps the engine's answer word for word and adds the tool trace.
    const ok = await request.post('/api/concierge/ask', { data: { question: SHELF_PROMPT, workspaceContext: { route: '/catalog' } } });
    expect(ok.status()).toBe(200);
    expect(ok.headers()['x-content-type-options']).toBe('nosniff');
    const shelf = (await ok.json()).reply;
    expect(shelf).toEqual(runDeterministicAgent(SHELF_PROMPT, { route: '/catalog' }).reply);
    expect(shelf).toMatchObject(evaluateConciergeQuery(SHELF_PROMPT, { route: '/catalog' }));
    expect(shelf.toolCalls.map((call) => call.name)).toEqual(['query_catalog']);

    const ctx = context('/room-3d');
    const live = await request.post('/api/concierge/ask', { data: { question: 'Audit my live 3D room & RT60', workspaceContext: ctx } });
    const audit = (await live.json()).reply;
    expect(audit).toEqual(runDeterministicAgent('Audit my live 3D room & RT60', ctx).reply);
    expect(audit).toMatchObject(evaluateConciergeQuery('Audit my live 3D room & RT60', ctx));
    expect(audit.clientActions).toEqual([]);

    const textPlain = await request.post('/api/concierge/ask', {
      headers: { 'Content-Type': 'text/plain' },
      data: JSON.stringify({ question: SHELF_PROMPT }),
    });
    expect(textPlain.status()).toBe(415);

    for (const [data, pattern] of [
      [{ question: 42 }, /question must be text/],
      [{ question: '   ' }, /Ask a question/],
      [{ question: SHELF_PROMPT, workspaceContext: [] }, /workspaceContext must be an object/],
      [{ question: SHELF_PROMPT, workspaceContext: { wallDraft: { ...serializeLayout(WALL), items: [{ productId: 'evil', finish: 'oak', xCm: 0, yCm: 0 }] } } }, /wallDraft/],
      [{ question: SHELF_PROMPT, workspaceContext: { currency: 'BTC' } }, /currency/],
    ]) {
      const refused = await request.post('/api/concierge/ask', { data });
      expect(refused.status()).toBe(400);
      const { error } = await refused.json();
      expect(error.code).toBe('invalid');
      expect(error.message).toMatch(pattern);
    }

    const prototypeKeys = await request.post('/api/concierge/ask', {
      headers: { 'Content-Type': 'application/json' },
      data: '{"question":"Floating Shelf 110 specs","__proto__":{"admin":true},"workspaceContext":{"constructor":{"prototype":{"x":1}}}}',
    });
    expect(prototypeKeys.status()).toBe(200);
  });

  test('POST /api/concierge/escalate is gatekeeper locked without a verified unresolved or unhelpful turn', async ({ request }) => {
    const headers = { 'X-Lumen-Client': guestNamespace() };
    const fields = {
      email: 'studio-review@lumen-e2e.com',
      subject: 'Curved marble beam',
      message: 'We need a 480 cm curved marble beam welded on site above the stair.',
      reason: 'unresolved_query',
    };
    const escalate = (data, extra = headers) => request.post('/api/concierge/escalate', { headers: extra, data });
    const expectLocked = async (response) => {
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toEqual({ code: 'gatekeeper_locked', message: GATEKEEPER_LOCKED_MESSAGE });
    };

    // A direct POST without a consultation, with only resolved turns, or with forged flags.
    await expectLocked(await escalate(fields));
    await expectLocked(await escalate({ ...fields, transcript: [] }));
    await expectLocked(await escalate({ ...fields, transcript: [{ question: SHELF_PROMPT, resolved: true }] }));
    await expectLocked(await escalate({ ...fields, transcript: [{ question: SHELF_PROMPT, resolved: false }] }));
    await expectLocked(
      await escalate({ ...fields, reason: 'marked_unhelpful', transcript: [{ question: 'I want to contact support', resolved: true, markedUnhelpful: true }] }),
    );
    await expectLocked(await escalate({ ...fields, transcript: Array.from({ length: 25 }, () => ({ question: BESPOKE, resolved: false })) }));

    // Past the gate, the fields are checked.
    const transcript = [{ question: BESPOKE, resolved: false }];
    const badEmail = await escalate({ ...fields, email: 'not-an-address', transcript });
    expect(badEmail.status()).toBe(400);
    expect((await badEmail.json()).error).toMatchObject({ code: 'invalid', fields: { email: expect.any(String) } });
    const shortBrief = await escalate({ ...fields, message: 'Too short', transcript });
    expect((await shortBrief.json()).error.fields.message).toMatch(/10 to 2000/);
    const mismatch = await escalate({ ...fields, reason: 'marked_unhelpful', transcript });
    expect((await mismatch.json()).error.message).toMatch(/does not match/);
    const noNamespace = await escalate({ ...fields, transcript }, {});
    expect(noNamespace.status()).toBe(400);

    const issued = await escalate({ ...fields, transcript, workspaceSummary: 'Asked from Overview (/).' });
    expect(issued.status()).toBe(201);
    const { ticket, tickets } = await issued.json();
    expect(ticket.ref).toMatch(TICKET_REF_PATTERN);
    expect(ticket).toMatchObject({
      email: fields.email,
      subject: fields.subject,
      message: fields.message,
      reason: 'unresolved_query',
      status: TICKET_QUEUED,
      inquiry: BESPOKE,
      turns: 1,
      workspaceSummary: 'Asked from Overview (/).',
    });
    expect(tickets.map((entry) => entry.ref)).toEqual([ticket.ref]);

    const list = await request.get('/api/tickets', { headers });
    expect(list.status()).toBe(200);
    expect((await list.json()).tickets).toEqual([ticket]);
    const other = await request.get('/api/tickets', { headers: { 'X-Lumen-Client': guestNamespace() } });
    expect((await other.json()).tickets).toEqual([]);
  });
});

/* Widget: bottom-right dock, panel, gatekeeper and tickets */

test.describe('Studio AI concierge widget', () => {
  test('stays locked through resolved answers and a premature request for a human', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog');
    const trigger = page.getByTestId('concierge-trigger');
    await expect(trigger).toHaveAccessibleName('Ask Lumen');
    await expect(trigger.locator('.concierge-trigger__label')).toHaveText('Ask Lumen');
    await expect(trigger).toHaveAttribute('title', 'Ask Lumen AI');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Closed, the panel is not mounted at all: the lock cannot be bypassed from the DOM.
    await expect(page.getByTestId('concierge-panel')).toHaveCount(0);

    const panel = await openConcierge(page);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAccessibleName('Lumen Studio AI Concierge');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Lumen AI');
    await expect(panel.getByTestId('concierge-badge')).toHaveText('Workspace Aware');
    await expect(panel).not.toContainText('LUMEN SPEC CONCIERGE');
    await expect(panel).toHaveAttribute('data-escalation', 'locked');
    await expect(page.getByTestId('concierge-input')).toBeFocused();
    await expect(page.getByTestId('concierge-quick-prompts').getByTestId('concierge-quick-prompt')).toHaveText(quickPromptsFor('/catalog'));
    await expect(page.getByTestId('concierge-gatekeeper-status')).toHaveText(LOCKED_COPY);

    const [call] = await Promise.all([
      page.waitForRequest(isApiCall('POST', '/api/concierge/ask')),
      page.getByTestId('concierge-quick-prompt').filter({ hasText: SHELF_PROMPT }).click(),
    ]);
    expect((await call.response()).status()).toBe(200);
    // The composer keeps focus while the chips disable for the pending reply.
    await expect(page.getByTestId('concierge-input')).toBeFocused();
    const shelf = page.getByTestId('concierge-reply').first();
    await expect(shelf).toHaveAttribute('data-resolved', 'true');
    await expect(shelf).toHaveAttribute('data-category', 'catalog');
    await expect(shelf).toHaveAttribute('data-transport', 'http');
    await expect(shelf).toContainText('LMN-SH-110');
    await expect(shelf.getByTestId('concierge-metrics')).toContainText('Anchors');
    await expect(shelf.getByTestId('concierge-action').first()).toHaveAttribute('href', '/catalog/floating-shelf-110');
    await expect(shelf.getByTestId('concierge-mark-unhelpful')).toHaveText(UNHELPFUL_COPY);

    const gate = await ask(page, 'I want to contact human support');
    await expect(gate).toHaveAttribute('data-category', 'gatekeeper');
    await expect(gate).toContainText(CONTACT_GATE_REPLY);
    await expect(gate.getByTestId('concierge-mark-unhelpful')).toHaveCount(0);
    await ask(page, 'Email human agent');
    await expect(panel).toHaveAttribute('data-escalation', 'locked');
    await expect(page.getByTestId('concierge-escalation-form')).toHaveCount(0);
    await expect(page.getByTestId('concierge-gatekeeper-status')).toHaveAttribute('data-escalation', 'locked');

    // Escape closes from inside and hands focus back; the session survives a route change.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Wall Studio' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    await trigger.click();
    await expect(page.getByTestId('concierge-reply')).toHaveCount(3);
    await expect(page.getByTestId('concierge-quick-prompt')).toHaveText(quickPromptsFor('/studio-2d'));
    await expect(page.getByTestId('concierge-context')).toHaveText('Context: 2D Wall Studio');
    await page.getByTestId('concierge-close').click();
    await expect(panel).toBeHidden();
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('path A: an inquiry the AI cannot resolve unlocks Studio Engineering Contact', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    const panel = await openConcierge(page);
    const reply = await ask(page, BESPOKE);
    await expect(reply).toHaveAttribute('data-resolved', 'false');
    await expect(reply).toHaveAttribute('data-category', 'engineering');
    expect(Number(await reply.getAttribute('data-confidence'))).toBeLessThan(UNRESOLVED_CONFIDENCE);
    await expect(reply).toContainText(ESCALATION_NOTICE);
    await expect(panel).toHaveAttribute('data-escalation', 'unlocked');
    await expect(panel).toHaveAttribute('data-escalation-reason', 'unresolved_query');
    await expect(page.getByTestId('concierge-gatekeeper-status')).toContainText('Studio Engineering Contact unlocked');

    const form = page.getByTestId('concierge-escalation-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('concierge-ticket-email')).toHaveValue('');
    await expect(form.getByTestId('concierge-ticket-subject')).toHaveValue(`Engineering review - ${BESPOKE}`.slice(0, 120));
    await expect(form.getByTestId('concierge-ticket-submit')).toHaveText('Transmit Engineering Ticket');

    // Client-side checks run before anything is sent.
    let sent = false;
    page.on('request', (request) => {
      if (isApiCall('POST', '/api/concierge/escalate')(request)) sent = true;
    });
    await form.getByTestId('concierge-ticket-submit').click();
    await expect(form.getByTestId('concierge-ticket-email-error')).toBeVisible();
    await expect(form.getByTestId('concierge-ticket-message-error')).toBeVisible();
    await expect(form.getByTestId('concierge-ticket-email')).toBeFocused();
    expect(sent).toBe(false);
    expect(errors).toEqual([]);
  });

  test('path B: marking a resolved answer as not resolving the issue unlocks contact', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/studio-2d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    const panel = await openConcierge(page);
    const reply = await ask(page, DRIVER_PROMPT);
    await expect(reply).toHaveAttribute('data-resolved', 'true');
    await expect(panel).toHaveAttribute('data-escalation', 'locked');
    await expect(page.getByTestId('concierge-escalation-form')).toHaveCount(0);

    await reply.getByTestId('concierge-mark-unhelpful').click();
    await expect(reply.getByTestId('concierge-marked-unhelpful')).toBeVisible();
    await expect(reply.getByTestId('concierge-mark-unhelpful')).toHaveCount(0);
    const followUp = page.getByTestId('concierge-reply').last();
    await expect(followUp).toHaveAttribute('data-kind', 'followup');
    await expect(followUp).toContainText('Understood - that answer did not settle your case.');
    await expect(followUp).toContainText('dV = I x R x L');
    await expect(panel).toHaveAttribute('data-escalation', 'unlocked');
    await expect(panel).toHaveAttribute('data-escalation-reason', 'marked_unhelpful');
    await expect(page.getByTestId('concierge-escalation-form')).toBeVisible();
    await expect(page.getByTestId('concierge-ticket-summary')).toContainText('Asked from 2D Wall Studio (/studio-2d).');
    expect(errors).toEqual([]);
  });

  test('transmits a ticket, confirms the LMN-T reference and lists it under Account', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const email = uniqueEmail('concierge');
    await page.goto('/');
    await signIn(page, email);
    await page.evaluate(
      ([wallKey, wall]) => localStorage.setItem(wallKey, JSON.stringify(wall)),
      [`lumen:${WALL_STORAGE_KEY}`, serializeLayout(WALL)],
    );

    await openConcierge(page);
    await ask(page, BESPOKE);
    const form = page.getByTestId('concierge-escalation-form');
    await expect(form.getByTestId('concierge-ticket-email')).toHaveValue(email);
    const subject = 'Curved marble beam over the stair';
    const brief = 'Site: 480 cm stair void, marble beam welded to the stringer, 24V lightbar recessed underneath.';
    await form.getByTestId('concierge-ticket-subject').fill(subject);
    await form.getByTestId('concierge-ticket-message').fill(brief);

    const [response] = await Promise.all([
      page.waitForResponse((res) => isApiCall('POST', '/api/concierge/escalate')(res.request())),
      form.getByTestId('concierge-ticket-submit').click(),
    ]);
    expect(response.status()).toBe(201);
    const payload = JSON.parse(response.request().postData());
    expect(payload).toMatchObject({ email, subject, message: brief, reason: 'unresolved_query' });
    expect(payload.transcript).toEqual([
      { question: BESPOKE, resolved: false, markedUnhelpful: false, category: 'engineering', confidence: expect.any(Number) },
    ]);
    expect(payload.workspaceSummary).toContain(`2D wall ${WALL.wall.widthCm} x ${WALL.wall.heightCm} cm`);
    const { ticket } = await response.json();
    expect(ticket.ref).toMatch(TICKET_REF_PATTERN);

    const confirmation = page.getByTestId('concierge-ticket-confirmation');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toBeFocused();
    await expect(confirmation.getByTestId('concierge-ticket-ref')).toHaveText(ticket.ref);
    await expect(confirmation).toContainText(TICKET_QUEUED);
    await expect(page.getByTestId('concierge-escalation-form')).toHaveCount(0);
    await expect(page.getByTestId('toast-message').filter({ hasText: ticket.ref })).toContainText('transmitted');

    await confirmation.getByRole('link', { name: 'View in Account' }).click();
    await expect(page.getByTestId('concierge-panel')).toBeHidden();
    const section = page.getByTestId('account-tickets-section');
    await expect(section).toHaveAttribute('data-state', 'ready');
    await expect(section.getByRole('heading', { name: 'Studio Engineering Tickets' })).toBeVisible();
    const row = section.locator(`[data-testid="account-ticket"][data-ticket-ref="${ticket.ref}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('account-ticket-ref')).toHaveText(ticket.ref);
    await expect(row.getByTestId('account-ticket-subject')).toHaveText(subject);
    await expect(row.getByTestId('account-ticket-status')).toHaveText(TICKET_QUEUED);
    await expect(row.getByTestId('account-ticket-time')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    await expect(row.getByTestId('account-ticket-summary')).toContainText('2D wall');
    await expect(row).toHaveAttribute('data-reason', 'unresolved_query');
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('a guest ticket moves into the account library on sign-in', async ({ page }) => {
    await page.goto('/');
    await openConcierge(page);
    await ask(page, DRIVER_PROMPT);
    await page.getByTestId('concierge-mark-unhelpful').click();
    const form = page.getByTestId('concierge-escalation-form');
    await form.getByTestId('concierge-ticket-email').fill('guest-studio@lumen-e2e.com');
    await form.getByTestId('concierge-ticket-message').fill('Our 24V run is 11 m to a 140 W load; the drop answer does not cover a mid-feed.');
    await form.getByTestId('concierge-ticket-submit').click();
    const ref = await page.getByTestId('concierge-ticket-ref').textContent();
    expect(ref).toMatch(TICKET_REF_PATTERN);
    await page.getByTestId('concierge-close').click();

    await signIn(page, uniqueEmail('claim'));
    await page.getByTestId('account-link').click();
    const row = page.locator(`[data-testid="account-ticket"][data-ticket-ref="${ref}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-reason', 'marked_unhelpful');
  });

  test('offline: the same engine answers on the device and a queued ticket replays through the gatekeeper', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog');
    await openConcierge(page);
    const online = await ask(page, SHELF_PROMPT);
    await expect(online).toHaveAttribute('data-transport', 'http');
    const onlineId = await online.getAttribute('data-reply-id');

    await page.route('**/api/**', (route) => route.abort());
    const offline = await ask(page, SHELF_PROMPT);
    await expect(offline).toHaveAttribute('data-transport', 'local');
    // Identical reply from either transport: one deterministic engine.
    expect(await offline.getAttribute('data-reply-id')).toBe(onlineId);

    await ask(page, BESPOKE);
    const form = page.getByTestId('concierge-escalation-form');
    await form.getByTestId('concierge-ticket-email').fill('offline-studio@lumen-e2e.com');
    await form.getByTestId('concierge-ticket-message').fill('Bespoke curved beam, needs a structural engineer on site.');
    await form.getByTestId('concierge-ticket-submit').click();
    const confirmation = page.getByTestId('concierge-ticket-confirmation');
    await expect(confirmation).toHaveAttribute('data-transport', 'local');
    await expect(confirmation).toContainText('stored on this device');
    const outbox = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `lumen:${TICKET_OUTBOX_STORAGE_KEY}`);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].owner).toBe('device');

    // Back online: the account load replays the outbox through POST /api/concierge/escalate.
    await page.unroute('**/api/**');
    await page.getByTestId('concierge-close').click();
    await signIn(page, uniqueEmail('offline'));
    const [replay] = await Promise.all([
      page.waitForResponse((res) => isApiCall('POST', '/api/concierge/escalate')(res.request())),
      page.getByTestId('account-link').click(),
    ]);
    expect(replay.status()).toBe(201);
    const row = page.getByTestId('account-ticket');
    await expect(row).toHaveCount(1);
    await expect(row).not.toHaveAttribute('data-pending');
    await expect(row.getByTestId('account-ticket-subject')).toContainText('Engineering review');
    expect(await page.evaluate((key) => localStorage.getItem(key), `lumen:${TICKET_OUTBOX_STORAGE_KEY}`)).toBeNull();
    expect(errors.filter((line) => !line.includes('net::ERR_FAILED'))).toEqual([]);
  });

  test('the closed pill never covers planner controls and steps aside for modal dialogs', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.addInitScript(
      ([roomKey, room, bagKey, bag]) => {
        localStorage.setItem(roomKey, JSON.stringify(room));
        localStorage.setItem(bagKey, JSON.stringify(bag));
      },
      [`lumen:${ROOM_STORAGE_KEY}`, serializeRoomState(ROOM), `lumen:${BAG_STORAGE_KEY}`, BAG],
    );
    const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1024, height: 768 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(size);
      const dock = page.getByTestId('concierge-dock');
      const trigger = page.getByTestId('concierge-trigger');
      const toggle = page.getByTestId('camera-settings-toggle');
      await expect(dock).toBeVisible();
      const pill = await trigger.boundingBox();
      const client = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
      expect(pill.width).toBeLessThanOrEqual(size.width < 560 ? 40 : 160);
      expect(pill.height).toBe(40);
      expect(Math.round(client.w - (pill.x + pill.width))).toBe(20);
      expect(Math.round(client.h - (pill.y + pill.height))).toBe(20);
      // Scrolled in from either edge, the camera key stays clear of the pill (scroll-padding-bottom).
      for (const align of ['end', 'start']) {
        await toggle.evaluate((el, block) => el.scrollIntoView({ block }), align);
        expect(overlap(pill, await toggle.boundingBox()), `toggle at ${size.width}, ${align}`).toBe(false);
      }

      // The popover can scroll into the dock's corner, so the closed dock steps aside while it is open.
      await toggle.click();
      const popover = page.getByTestId('camera-settings');
      await expect(popover).toBeVisible();
      await expect(dock).toBeHidden();
      const wire = page.getByTestId('camera-wireframe');
      for (const align of ['start', 'end']) {
        await wire.evaluate((el, block) => el.scrollIntoView({ block }), align);
        const onTarget = await wire.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return Boolean(hit) && el.contains(hit);
        });
        expect(onTarget, `wireframe hit at ${size.width}, ${align}`).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(popover).toBeHidden();
      await expect(dock).toBeVisible();
    }

    // Modal layers own the screen: the dock steps aside and comes back intact.
    await page.setViewportSize({ width: 1280, height: 720 });
    const dock = page.getByTestId('concierge-dock');
    await expect(dock).toBeVisible();
    await page.getByRole('banner').getByRole('button', { name: /cart/i }).click();
    await expect(page.getByRole('dialog', { name: 'Cart' })).toBeVisible();
    await expect(dock).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dock).toBeVisible();
    await expect(page.getByTestId('concierge-trigger')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

/* Lumen AI: plain-language guide to the site, resilient transport, stealth panel */

const TYPOGRAPHIC_APOSTROPHE = String.fromCharCode(0x2019);

test.describe('Lumen AI conversational guide, resilient fallback and stealth panel', () => {
  test('explains the site, the planners and their controls in plain words, decided by the question alone', () => {
    const open = evaluateConciergeQuery(OPEN_3D, { route: '/' });
    expect(open).toMatchObject({ category: 'guide', resolved: true, suggestedActions: LAUNCH_ACTIONS });
    expect(open.confidence).toBeGreaterThanOrEqual(0.9);
    expect(open.answer).toContain('Clicking 3D Room in the top navigation bar scrolls to the interactive 3D Spatial Studio preview');
    expect(open.answer).toContain('click Launch 3D Spatial Studio in that section, or use the direct launch button right below this message');
    // A fault report gets the checks that clear it.
    expect(open.answer).toContain('hardware acceleration');
    expect(open.answer).not.toContain(ESCALATION_NOTICE);
    expect(canMarkUnhelpful(open)).toBe(true);

    // Contractions with or without the apostrophe, typos and other names for the planner land on the same intent.
    for (const variant of [
      "Why can't I open the 3D room designer?",
      `Why can${TYPOGRAPHIC_APOSTROPHE}t I open the 3-D room planer`,
      'the 3d modeler wont open',
      'Where is the 3D planner?',
      'How do I open 3D Room?',
      'help me launch the spatial studio',
    ]) {
      const reply = evaluateConciergeQuery(variant);
      expect({ category: reply.category, resolved: reply.resolved, actions: reply.suggestedActions }, variant).toEqual({
        category: 'guide',
        resolved: true,
        actions: LAUNCH_ACTIONS,
      });
    }
    // Inside the planner the same verdict leads with the fault checks.
    const inside = evaluateConciergeQuery(OPEN_3D, { route: '/room-3d' });
    expect(inside.category).toBe('guide');
    expect(inside.answer.startsWith('You are already in the 3D Spatial Studio (/room-3d).')).toBe(true);

    const move = evaluateConciergeQuery('How do I move furniture in 3D or 2D?');
    expect(move).toMatchObject({ category: 'guide', resolved: true });
    for (const fact of ['Asset Shelf', 'X/Y Transform Gizmo', 'press G to grab', 'Grid Snap', '5 cm', 'Shift + Click', 'marquee', 'Align & Distribute']) {
      expect(move.answer, fact).toContain(fact);
    }

    const walk = evaluateConciergeQuery('How do I walk around inside the room and rotate 360 degrees?');
    expect(walk.category).toBe('guide');
    for (const fact of ['W A S D', 'a full 360 degrees', '5 to 85 deg', '50 to 92 deg', 'Compact 320 x 280', 'Grand Loft 800 x 650', '900 x 900 x 420 cm']) {
      expect(walk.answer, fact).toContain(fact);
    }
    expect(walk.suggestedActions[0]).toEqual(LAUNCH_ACTIONS[1]);
    expect(evaluateConciergeQuery('How do I change the room size?').answer.startsWith('Room size lives in the Envelope & Lighting panel')).toBe(true);

    const modes = evaluateConciergeQuery('What is Visual vs Specs mode?');
    expect(modes.category).toBe('guide');
    expect(modes.answer).toContain('Specs reveals the technical layer: the 24V bus wiring');
    const keys = evaluateConciergeQuery('What are the keyboard shortcuts?');
    for (const fact of ['Ctrl+K (Cmd+K on a Mac)', 'Ctrl+Z undoes', 'Ctrl+Y or Ctrl+Shift+Z', 'Zen, at the right of the 3D studio header']) {
      expect(keys.answer, fact).toContain(fact);
    }
    expect(evaluateConciergeQuery('What does the top bar do?').answer).toContain('3D Room (it scrolls to the 3D Spatial Studio preview');

    // Greetings and "what is Lumen" get a warm tour of the platform, never the escalation notice.
    for (const question of ['Hi', 'Hello', 'What can you do?', 'What is Lumen?', 'How is this platform architected?']) {
      const reply = evaluateConciergeQuery(question);
      expect(reply, question).toMatchObject({ category: 'concierge', resolved: true });
      expect(reply.confidence, question).toBeGreaterThanOrEqual(0.85);
      expect(reply.answer, question).toContain('12 canonical parts on one 24V DC SELV spine');
      expect(reply.answer, question).not.toContain(ESCALATION_NOTICE);
      expect(canMarkUnhelpful(reply), question).toBe(false);
    }
    expect(evaluateConciergeQuery('How is this platform architected?').answer).toContain('pure, deterministic engines');
    // The brand is not the unit, and the rest of the brain is untouched.
    expect(evaluateConciergeQuery("What is Lumen's 24V bus?").category).toBe('electrical');
    expect(evaluateConciergeQuery(SHELF_PROMPT).category).toBe('catalog');
    expect(evaluateConciergeQuery('Audit my live 3D room & RT60', context('/room-3d')).category).toBe('workspace');

    // Software faults never read as freight damage, nor planner sizes as bespoke work; real cases still escalate.
    expect(evaluateConciergeQuery('The 3D designer is broken')).toMatchObject({ category: 'guide', resolved: true });
    expect(evaluateConciergeQuery('Can I set a custom size for my room?')).toMatchObject({ category: 'guide', resolved: true });
    expect(evaluateConciergeQuery('My shelf arrived broken').resolved).toBe(false);
    expect(evaluateConciergeQuery(BESPOKE).resolved).toBe(false);

    // Verdicts replay identically without the workspace, and a guide answer can still open the gate.
    const ctx = context('/room-3d');
    for (const question of [OPEN_3D, 'How do I move furniture in 3D or 2D?', 'What is Visual vs Specs mode?', 'Hello']) {
      const live = evaluateConciergeQuery(question, ctx);
      const replay = evaluateConciergeQuery(question);
      expect({ category: replay.category, resolved: replay.resolved, confidence: replay.confidence }, question).toEqual({
        category: live.category,
        resolved: live.resolved,
        confidence: live.confidence,
      });
    }
    expect(verifyEscalationTranscript([{ question: OPEN_3D, resolved: true, markedUnhelpful: true }]).reasons).toEqual(['marked_unhelpful']);
    expect(composeFollowUp(OPEN_3D).answer).toContain('Troubleshooting checklist');
    expect(quickPromptsFor('/')[0]).toBe('How do I open the 3D room designer?');
  });

  test('answers "Why cant I open 3D room designer" with a direct launch key and keeps answering when the API 404s or fails', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await openConcierge(page);

    const online = await ask(page, OPEN_3D);
    await expect(online).toHaveAttribute('data-category', 'guide');
    await expect(online).toHaveAttribute('data-resolved', 'true');
    await expect(online).toHaveAttribute('data-transport', 'http');
    await expect(online).toContainText('Clicking 3D Room in the top navigation bar');
    const actions = online.getByTestId('concierge-action');
    await expect(actions).toHaveText(LAUNCH_ACTIONS.map((action) => action.label));
    await expect(actions.first()).toHaveAttribute('href', '/room-3d');
    await expect(actions.nth(1)).toHaveAttribute('href', '/room-3d?lens=inside');
    const onlineId = await online.getAttribute('data-reply-id');

    // A dev server started on an older checkout answers the route with its JSON 404; a static
    // host, a broken proxy or a tampered reply answer with anything. The visitor still gets the answer.
    const faults = [
      { status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'No Lumen Cloud endpoint at this path.' } }) },
      { status: 404, body: '{}' },
      { status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Lumen Cloud hit an unexpected fault.' } }) },
      { status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' },
      { status: 200, contentType: 'application/json', body: JSON.stringify({ reply: { id: 'LMN-C-forged' } }) },
    ];
    for (const fault of faults) {
      await page.route('**/api/concierge/ask', (route) => route.fulfill(fault));
      const reply = await ask(page, OPEN_3D);
      await expect(reply, `HTTP ${fault.status}`).toHaveAttribute('data-transport', 'local');
      await expect(reply, `HTTP ${fault.status}`).toHaveAttribute('data-resolved', 'true');
      // One deterministic engine on either side: the same reply, id for id.
      expect(await reply.getAttribute('data-reply-id'), `HTTP ${fault.status}`).toBe(onlineId);
      await page.unroute('**/api/concierge/ask');
    }
    const panel = page.getByTestId('concierge-panel');
    await expect(page.getByTestId('concierge-fault')).toHaveCount(0);
    await expect(panel).not.toContainText('No Lumen Cloud endpoint');
    await expect(panel).not.toContainText('unexpected fault');
    await expect(panel).toHaveAttribute('data-escalation', 'locked');

    // The direct key opens the full-screen editor.
    await actions.first().click();
    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await expect(panel).toBeHidden();
    expect(errors.filter((line) => !/status of (404|500|502)/.test(line))).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('stealth panel: a basalt trigger with the Lumen mark, graphite questions, a silent locked gate and Specs-only metadata', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Navbar: Search and Cart wear matching 14 px glyphs on one stroke weight, centred in their pills.
    const banner = page.getByRole('banner');
    const cart = banner.getByRole('button', { name: 'Cart (0)' });
    const bag = cart.getByTestId('bag-glyph');
    const search = banner.getByTestId('command-palette-trigger').locator('svg');
    await expect(bag).toBeVisible();
    const [bagBox, searchBox, cartBox] = await Promise.all([bag.boundingBox(), search.boundingBox(), cart.boundingBox()]);
    expect([bagBox.width, bagBox.height]).toEqual([14, 14]);
    expect([searchBox.width, searchBox.height]).toEqual([14, 14]);
    expect(Math.abs(bagBox.y + bagBox.height / 2 - (cartBox.y + cartBox.height / 2))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(bagBox.y - searchBox.y)).toBeLessThanOrEqual(0.5);
    expect(await bag.evaluate((el) => [...el.querySelectorAll('path')].map((path) => path.getAttribute('stroke-width')))).toEqual(['1.25', '1.25']);
    expect(await search.evaluate((el) => el.querySelector('circle').getAttribute('stroke-width'))).toBe('1.25');
    await expect(cart).toHaveCSS('column-gap', '8px');
    await expect(banner.getByTestId('command-palette-trigger')).toHaveCSS('column-gap', '8px');

    // Trigger: dark basalt glass and the Lumen mark with a champagne slit, warming on hover.
    const trigger = page.getByTestId('concierge-trigger');
    await expect(trigger.getByTestId('lumen-mark')).toBeVisible();
    await expect(trigger.locator('.aperture-glyph')).toHaveCount(0);
    await expect(trigger).toHaveCSS('background-color', 'rgba(20, 19, 17, 0.92)');
    await expect(trigger).toHaveCSS('color', 'rgb(244, 241, 234)');
    await expect(trigger).toHaveCSS('border-top-color', 'rgba(255, 255, 255, 0.12)');
    await expect(trigger.locator('[data-part="aperture"]')).toHaveCSS('fill', 'rgb(229, 199, 153)');
    await trigger.hover();
    await expect(trigger).toHaveCSS('border-top-color', 'rgba(229, 199, 153, 0.45)');
    const panel = await openConcierge(page);
    await page.mouse.move(10, 400);
    await expect(trigger).toHaveCSS('border-top-color', 'rgba(229, 199, 153, 0.45)');
    await expect(trigger).toHaveCSS('background-color', 'rgba(26, 24, 21, 0.94)');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Lumen AI');
    await expect(panel.locator('.concierge-panel__head').getByTestId('lumen-mark')).toBeVisible();

    // Silent gatekeeper: spoken to assistive technology, never painted, no padlock.
    const gate = page.getByTestId('concierge-gatekeeper-status');
    await expect(gate).toHaveText(LOCKED_COPY);
    await expect(gate).toHaveAttribute('role', 'status');
    await expect(gate).toHaveClass(/visually-hidden/);
    const gateLook = await gate.evaluate((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return { position: style.position, overflow: style.overflow, width: box.width, height: box.height };
    });
    expect(gateLook).toEqual({ position: 'absolute', overflow: 'hidden', width: 1, height: 1 });
    await expect(panel.locator('.concierge-gate__glyph, .concierge-gate svg')).toHaveCount(0);

    // A warm charcoal-bronze question bubble on the right; the answer sits straight on the
    // glass beside a 22 px avatar, never in a yellow block.
    const reply = await ask(page, 'What is Visual vs Specs mode?');
    const question = page.getByTestId('concierge-question').last();
    await expect(question).toHaveCSS('background-color', 'rgb(42, 38, 33)');
    await expect(question).toHaveCSS('color', 'rgb(244, 241, 234)');
    await expect(question).toHaveCSS('border-top-color', 'rgba(229, 199, 153, 0.22)');
    await expect(question).toHaveCSS('border-top-left-radius', '18px');
    await expect(question).toHaveCSS('border-bottom-right-radius', '4px');
    await expect(reply).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const avatar = reply.getByTestId('concierge-avatar');
    await expect(avatar.getByTestId('lumen-mark')).toBeVisible();
    await expect(avatar).toHaveCSS('width', '22px');
    await expect(avatar).toHaveCSS('height', '22px');
    const body = reply.locator('.concierge-msg__body');
    await expect(body).toHaveCSS('font-size', '13.5px');
    await expect(body).toHaveCSS('line-height', '21.6px');
    await expect(body).toHaveCSS('color', 'rgb(230, 226, 218)');
    // The answer streams in once; its flag lands on the element, so a reopened panel never replays it.
    await expect(reply).toHaveAttribute('data-revealed', 'true');
    await expect(body).toHaveCSS('mask-image', 'none');
    const footer = reply.getByTestId('concierge-mark-unhelpful');
    await expect(footer).toHaveText(UNHELPFUL_COPY);
    await expect(footer).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    // Confidence and sources are Specs-mode detail; Visual keeps the answer clean.
    await expect(reply.getByTestId('concierge-metrics')).toBeVisible();
    await expect(reply.getByTestId('concierge-confidence')).toBeHidden();
    await expect(reply.getByTestId('concierge-citations')).toBeHidden();
    await page.getByTestId('mode-switch').getByRole('button', { name: /^Specs/ }).click();
    await expect(reply.getByTestId('concierge-confidence')).toBeVisible();
    await expect(reply.getByTestId('concierge-confidence')).toHaveText(/^Resolved \d+%$/);
    await expect(reply.getByTestId('concierge-citations')).toBeVisible();
    await expect(page.getByTestId('concierge-send')).toHaveAccessibleName('Ask');

    // Closing and reopening keeps the settled answer settled.
    await page.getByTestId('concierge-close').click();
    await trigger.click();
    await expect(reply).toHaveAttribute('data-revealed', 'true');
    await expect(body).toHaveCSS('mask-image', 'none');
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('chat UX: a welcome hero, starter cards that fold into a chip bar, a structured reply and New chat', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(([key, room]) => localStorage.setItem(key, JSON.stringify(room)), [`lumen:${ROOM_STORAGE_KEY}`, serializeRoomState(ROOM)]);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const panel = await openConcierge(page);
    const starters = quickPromptsFor('/room-3d');

    // Welcome: the mark, one question, one line and the four starters as cards with arrows.
    await expect(panel).toHaveAttribute('data-thread', 'welcome');
    const welcome = panel.getByTestId('concierge-welcome');
    await expect(welcome.getByRole('heading', { level: 3 })).toHaveText('How can I help with your space?');
    await expect(welcome).toContainText('Ask about any part, 24V wiring, or audit your live 3D room.');
    await expect(welcome.getByTestId('lumen-mark')).toBeVisible();
    const prompts = panel.getByTestId('concierge-quick-prompts');
    await expect(prompts).toHaveAttribute('data-layout', 'cards');
    await expect(prompts.getByTestId('concierge-quick-prompt')).toHaveText(starters);
    await expect(prompts.locator('.concierge-prompt__arrow')).toHaveCount(4);
    await expect(panel.getByTestId('concierge-reset')).toHaveCount(0);

    // An audit answers as a lead sentence, four labelled bullets and at most four pills.
    await prompts.getByTestId('concierge-quick-prompt').filter({ hasText: 'Audit my live 3D room & RT60' }).click();
    const reply = page.getByTestId('concierge-reply').first();
    await expect(reply).toHaveAttribute('data-category', 'workspace');
    await expect(panel).toHaveAttribute('data-state', 'idle');
    await expect(reply.getByTestId('concierge-avatar')).toHaveCSS('width', '22px');
    await expect(reply.locator('.concierge-msg__lead')).toHaveText('Your 3D room carries 5 modules: North 2 / East 1 / South 1 / West 1.');
    await expect(reply.locator('.concierge-msg__list li .concierge-msg__label')).toHaveText(['Power', 'Acoustics', 'Light', 'Layout']);
    await expect(reply.locator('.concierge-msg__label').first()).toHaveCSS('font-weight', '600');
    await expect(reply.getByTestId('concierge-metrics').locator('.concierge-metric')).toHaveCount(4);
    const words = await reply.locator('.concierge-msg__body').evaluate((el) => el.innerText.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length);
    expect(words).toBeLessThanOrEqual(65);

    // Active thread: the starters fold into one chip row docked on the composer, and the
    // thread keeps at least 80% of the full-height panel.
    await expect(panel).toHaveAttribute('data-thread', 'active');
    await expect(panel.getByTestId('concierge-welcome')).toHaveCount(0);
    await expect(prompts).toHaveAttribute('data-layout', 'chips');
    await expect(prompts.getByTestId('concierge-quick-prompt')).toHaveText(starters);
    const geometry = await panel.evaluate((el) => {
      const box = (node) => node.getBoundingClientRect();
      const chips = box(el.querySelector('[data-testid="concierge-quick-prompts"]'));
      const composer = box(el.querySelector('.concierge-composer'));
      return {
        chipsHeight: chips.height,
        dock: Math.round(composer.top - chips.bottom),
        rows: new Set([...el.querySelectorAll('[data-testid="concierge-quick-prompt"]')].map((chip) => Math.round(box(chip).top))).size,
        share: box(el.querySelector('.concierge-panel__body')).height / box(el).height,
      };
    });
    expect(geometry.chipsHeight).toBeLessThanOrEqual(34);
    expect(geometry).toMatchObject({ dock: 0, rows: 1 });
    expect(geometry.share).toBeGreaterThanOrEqual(0.8);

    // The question: a warm bubble on the right. The composer: one pill with a round send key.
    const bubble = await page.getByTestId('concierge-question').first().evaluate((el) => {
      const body = el.closest('.concierge-panel__body');
      const style = getComputedStyle(body);
      const left = body.getBoundingClientRect().left + body.clientLeft + Number.parseFloat(style.paddingLeft);
      const right = body.getBoundingClientRect().left + body.clientLeft + body.clientWidth - Number.parseFloat(style.paddingRight);
      const box = el.getBoundingClientRect();
      return { gap: Math.abs(right - box.right), share: box.width / (right - left) };
    });
    expect(bubble.gap).toBeLessThanOrEqual(1);
    expect(bubble.share).toBeLessThanOrEqual(0.821);
    // The composer keeps focus after every send; its resting edge shows once it lets go.
    const field = panel.locator('.concierge-composer__field');
    const input = page.getByTestId('concierge-input');
    await expect(field).toHaveCSS('background-color', 'rgb(24, 23, 21)');
    await expect(field).toHaveCSS('border-top-color', 'rgba(229, 199, 153, 0.5)');
    await input.blur();
    await expect(field).toHaveCSS('border-top-color', 'rgba(255, 255, 255, 0.14)');
    expect(Number.parseFloat(await field.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(20);
    await input.focus();
    await expect(field).toHaveCSS('border-top-color', 'rgba(229, 199, 153, 0.5)');
    const send = page.getByTestId('concierge-send');
    await expect(send).toHaveAccessibleName('Ask');
    await expect(send).toHaveCSS('width', '32px');
    await expect(send).toHaveCSS('border-top-left-radius', '999px');

    // A chip asks straight from the bar; New chat clears the thread back to the welcome.
    await prompts.getByTestId('concierge-quick-prompt').filter({ hasText: 'How do I walk inside at 165 cm?' }).click();
    await expect(page.getByTestId('concierge-reply')).toHaveCount(2);
    await expect(panel).toHaveAttribute('data-state', 'idle');
    const reset = panel.getByTestId('concierge-reset');
    await expect(reset).toHaveAccessibleName('New chat');
    await reset.click();
    await expect(panel).toHaveAttribute('data-thread', 'welcome');
    await expect(page.getByTestId('concierge-reply')).toHaveCount(0);
    await expect(page.getByTestId('concierge-question')).toHaveCount(0);
    await expect(panel.getByTestId('concierge-quick-prompts')).toHaveAttribute('data-layout', 'cards');
    await expect(panel.getByTestId('concierge-reset')).toHaveCount(0);
    await expect(page.getByTestId('concierge-input')).toBeFocused();
    await expect(panel).toHaveAttribute('data-escalation', 'locked');
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
