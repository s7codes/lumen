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
import { formatInt } from '../src/lib/format.js';
import { buildQuote } from '../src/lib/quote.js';
import { createRoomState, findRoomConflicts, mountInRoom, ROOM_STORAGE_KEY, serializeRoomState, unrolledRoom, wallCounts } from '../src/lib/room-3d.js';
import { computeEnvironmentalPhysics } from '../src/lib/room-physics.js';
import { layoutFromPreset, serializeLayout, summarizeWall, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

// Test value for the local API under test; the server only length-checks it.
const TEST_PASSWORD = 'nordic-test-0042';
const LOCKED_COPY = 'Direct engineering contact is locked while Studio AI handles your questions.';
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
    const ok = await request.post('/api/concierge/ask', { data: { question: SHELF_PROMPT, workspaceContext: { route: '/catalog' } } });
    expect(ok.status()).toBe(200);
    expect(ok.headers()['x-content-type-options']).toBe('nosniff');
    expect((await ok.json()).reply).toEqual(evaluateConciergeQuery(SHELF_PROMPT, { route: '/catalog' }));

    const ctx = context('/room-3d');
    const live = await request.post('/api/concierge/ask', { data: { question: 'Audit my live 3D room & RT60', workspaceContext: ctx } });
    expect((await live.json()).reply).toEqual(evaluateConciergeQuery('Audit my live 3D room & RT60', ctx));

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
    await expect(trigger).toHaveAccessibleName('Ask Studio AI');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Closed, the panel is not mounted at all: the lock cannot be bypassed from the DOM.
    await expect(page.getByTestId('concierge-panel')).toHaveCount(0);

    const panel = await openConcierge(page);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveAttribute('role', 'dialog');
    await expect(panel).toHaveAccessibleName('Lumen Studio AI Concierge');
    await expect(panel).toContainText('LUMEN SPEC CONCIERGE // LIVE WORKSPACE RAG');
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
    await expect(shelf.getByTestId('concierge-mark-unhelpful')).toHaveText('Did not resolve my issue');

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
