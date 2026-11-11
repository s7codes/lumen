import { useId, useMemo, useRef, useState } from 'react';
import { useModalDialog } from '../hooks/useModalDialog.js';
import { elevationOf, SOURCE_GROUPS } from '../lib/diff-sources.js';
import { formatInt, formatUsd, formatWatts, padIndex } from '../lib/format.js';
import { compareProjectStates, formatSignedDelta } from '../lib/project-diff.js';
import { ElevationThumb } from './ElevationThumb.jsx';
import { ChevronGlyph } from './icons.jsx';
import '../styles/project-diff.css';

const GROUP_ORDER = ['draft', 'cloud', 'baseline'];

function DeltaGlyph() {
  return (
    <svg className="diff-kpi__glyph" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
      <path d="M6 2 10.5 10h-9z" stroke="currentColor" strokeWidth="1" strokeLinejoin="miter" />
    </svg>
  );
}

function SwapGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="square" />
    </svg>
  );
}

function judge(delta, { lowerIsBetter, improved, regressed }) {
  if (delta === 0) return { note: 'Unchanged', better: undefined };
  const good = lowerIsBetter ? delta < 0 : delta > 0;
  return { note: good ? improved : regressed, better: String(good) };
}

/** The six headline deltas, B minus A. RT60 down and STI up are improvements. */
function kpiCards({ deltas }) {
  const { modules, priceUsd, loadW, activeW, luxAvg, fluxLm, rt60Sec, stiScore } = deltas;
  const rt60 = judge(rt60Sec.delta, { lowerIsBetter: true, improved: 'Added damping', regressed: 'Longer decay' });
  const sti = judge(stiScore.delta, { lowerIsBetter: false, improved: 'Clearer speech', regressed: 'Less intelligible' });
  return [
    {
      key: 'modules',
      label: 'Modules',
      delta: modules.delta,
      value: formatSignedDelta(modules.delta),
      detail: `${padIndex(modules.base)} to ${padIndex(modules.target)}`,
    },
    {
      key: 'price',
      label: 'Price',
      delta: priceUsd.delta,
      value: formatSignedDelta(priceUsd.delta, 0, formatUsd),
      detail: `${formatUsd(priceUsd.base)} to ${formatUsd(priceUsd.target)}`,
    },
    {
      key: 'load',
      label: '24V Load',
      delta: loadW.delta,
      value: `${formatSignedDelta(loadW.delta, 0, formatWatts)} W`,
      detail: `${formatWatts(loadW.base)} to ${formatWatts(loadW.target)} W`,
      note: `Live ${formatSignedDelta(activeW.delta, 0, formatWatts)} W`,
    },
    {
      key: 'lux',
      label: 'Illuminance',
      delta: luxAvg.delta,
      value: `${formatSignedDelta(luxAvg.delta, 0, formatInt)} lx`,
      detail: `${formatInt(luxAvg.base)} to ${formatInt(luxAvg.target)} lx`,
      note: `Flux ${formatSignedDelta(fluxLm.delta, 0, formatInt)} lm`,
    },
    {
      key: 'rt60',
      label: 'RT60',
      delta: rt60Sec.delta,
      value: `${formatSignedDelta(rt60Sec.delta, 2)} s`,
      detail: `${rt60Sec.base.toFixed(2)} to ${rt60Sec.target.toFixed(2)} s`,
      note: rt60.note,
      better: rt60.better,
    },
    {
      key: 'sti',
      label: 'STI',
      delta: stiScore.delta,
      value: formatSignedDelta(stiScore.delta, 2),
      detail: `${stiScore.base.toFixed(2)} to ${stiScore.target.toFixed(2)}`,
      note: sti.note,
      better: sti.better,
    },
  ];
}

function SourcePicker({ side, label, value, sources, onChange, testId }) {
  const id = useId();
  const groups = GROUP_ORDER.map((group) => [group, sources.filter((source) => source.group === group)]).filter(
    ([, list]) => list.length > 0,
  );
  return (
    <div className="diff-picker" data-side={side}>
      <label className="diff-picker__label" htmlFor={id}>
        <span className="diff-picker__side">{side}</span>
        {label}
      </label>
      <div className="diff-picker__well">
        <select
          id={id}
          className="diff-picker__select"
          value={value}
          data-testid={testId}
          onChange={(event) => onChange(event.target.value)}
        >
          {groups.map(([group, list]) => (
            <optgroup key={group} label={SOURCE_GROUPS[group]}>
              {list.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronGlyph className="diff-picker__chevron" />
      </div>
    </div>
  );
}

function DiffThumb({ side, role, source, subject, marks }) {
  const view = elevationOf(subject);
  return (
    <figure className="diff-card diff-thumb" data-testid={`diff-thumb-${side.toLowerCase()}`} data-kind={subject.kind}>
      <figcaption className="diff-thumb__caption">
        <span className="diff-thumb__side">
          {side} / {role}
        </span>
        <span className="diff-thumb__name">{source.name}</span>
        <span className="diff-thumb__meta">{source.caption}</span>
      </figcaption>
      <ElevationThumb
        {...view}
        marks={marks}
        className="diff-thumb__svg"
        label={`${side}: ${source.label}, elevation with ${view.items.length} modules`}
      />
    </figure>
  );
}

function changeGroups(diff) {
  const { added, removed, modified } = diff.changes;
  return [
    {
      kind: 'envelope',
      title: 'Envelope',
      sign: '~',
      rows: diff.envelope.map((entry) => ({ key: entry.field, name: entry.field, detail: `${entry.from} to ${entry.to}` })),
    },
    {
      kind: 'added',
      title: 'Added',
      sign: '+',
      rows: added.map((entry) => ({ key: entry.uid, uid: entry.uid, name: entry.name, detail: entry.summary })),
    },
    {
      kind: 'removed',
      title: 'Removed',
      sign: '-',
      rows: removed.map((entry) => ({ key: entry.uid, uid: entry.uid, name: entry.name, detail: entry.summary })),
    },
    {
      kind: 'modified',
      title: 'Modified',
      sign: '~',
      rows: modified.map((entry) => ({
        key: `${entry.baseUid}:${entry.uid}`,
        uid: entry.uid,
        name: entry.name,
        detail: entry.summary,
        fields: entry.fields.join(' '),
      })),
    },
  ].filter((group) => group.rows.length > 0);
}

function ChangeLog({ diff, titleId }) {
  const { added, removed, modified, unchanged } = diff.changes;
  const tally = `${padIndex(added.length)} added / ${padIndex(removed.length)} removed / ${padIndex(modified.length)} modified / ${padIndex(unchanged)} unchanged`;
  return (
    <section className="diff-card diff-log" aria-labelledby={titleId}>
      <header className="diff-log__head">
        <h3 id={titleId} className="diff-section-title">
          Change Log
        </h3>
        <p className="diff-log__tally" data-testid="diff-tally">
          {tally}
        </p>
      </header>
      <div
        className="diff-log__groups"
        data-testid="diff-change-list"
        data-added={added.length}
        data-removed={removed.length}
        data-modified={modified.length}
        data-unchanged={unchanged}
      >
        {diff.identical ? (
          <p className="diff-log__empty" data-testid="diff-identical">
            No differences. B matches A module for module.
          </p>
        ) : (
          changeGroups(diff).map((group) => (
            <section key={group.kind} className="diff-group" data-group={group.kind}>
              <h4 className="diff-group__title">
                {group.title} ({group.sign})<span className="diff-group__count">{padIndex(group.rows.length)}</span>
              </h4>
              <ul className="diff-group__list">
                {group.rows.map((row) => (
                  <li
                    key={row.key}
                    className="diff-row"
                    data-testid="diff-change"
                    data-change={group.kind}
                    data-uid={row.uid}
                    data-fields={row.fields}
                  >
                    <span className="diff-row__sign" aria-hidden="true">
                      {group.sign}
                    </span>
                    <span className="diff-row__name">{row.name}</span>
                    <span className="diff-row__detail">{row.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </section>
  );
}

function DiffWorkspace({ sources, initialBase, initialTarget }) {
  const uid = useId();
  const byId = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const [baseId, setBaseId] = useState(() => (byId.has(initialBase) ? initialBase : sources[0].id));
  const [targetId, setTargetId] = useState(() =>
    byId.has(initialTarget) ? initialTarget : (sources[1] ?? sources[0]).id,
  );
  const base = byId.get(baseId) ?? sources[0];
  const target = byId.get(targetId) ?? sources[0];
  const diff = useMemo(() => compareProjectStates(base.subject, target.subject), [base, target]);

  const marks = useMemo(() => {
    const a = new Map();
    const b = new Map();
    for (const entry of diff.changes.removed) a.set(entry.uid, 'removed');
    for (const entry of diff.changes.added) b.set(entry.uid, 'added');
    for (const entry of diff.changes.modified) {
      a.set(entry.baseUid, 'modified');
      b.set(entry.uid, 'modified');
    }
    return { a, b };
  }, [diff]);

  // Only ids the dialog itself offered are accepted from the selects.
  const pick = (setter) => (id) => {
    if (byId.has(id)) setter(id);
  };
  const swap = () => {
    setBaseId(target.id);
    setTargetId(base.id);
  };

  return (
    <div className="diff-modal__body" data-base={base.id} data-target={target.id}>
      <div className="diff-pickers">
        <SourcePicker
          side="A"
          label="Baseline Project"
          value={base.id}
          sources={sources}
          onChange={pick(setBaseId)}
          testId="diff-select-base"
        />
        <button type="button" className="diff-swap" data-testid="diff-swap" aria-label="Swap A and B" onClick={swap}>
          <SwapGlyph />
          <span>Swap</span>
        </button>
        <SourcePicker
          side="B"
          label="Comparison Target"
          value={target.id}
          sources={sources}
          onChange={pick(setTargetId)}
          testId="diff-select-target"
        />
      </div>

      <div className="diff-thumbs">
        <DiffThumb side="A" role="Baseline" source={base} subject={diff.subjects.base} marks={marks.a} />
        <DiffThumb side="B" role="Target" source={target} subject={diff.subjects.target} marks={marks.b} />
      </div>
      <p className="diff-legend" aria-hidden="true">
        <span className="diff-legend__key" data-key="added" />
        Added
        <span className="diff-legend__key" data-key="modified" />
        Modified
        <span className="diff-legend__key" data-key="removed" />
        Removed
      </p>

      <dl className="diff-kpis" aria-label="Deltas, B against A" data-testid="diff-kpis">
        {kpiCards(diff).map((card) => (
          <div
            key={card.key}
            className="diff-card diff-kpi"
            data-testid={`diff-kpi-${card.key}`}
            data-delta={card.delta}
            data-trend={card.delta > 0 ? 'up' : card.delta < 0 ? 'down' : 'flat'}
            data-better={card.better}
          >
            <dt className="diff-kpi__label">
              <DeltaGlyph />
              {card.label}
            </dt>
            <dd className="diff-kpi__body">
              <span className="diff-kpi__value" data-testid={`diff-kpi-${card.key}-value`}>
                {card.value}
              </span>
              <span className="diff-kpi__detail">{card.detail}</span>
              {card.note && <span className="diff-kpi__note">{card.note}</span>}
            </dd>
          </div>
        ))}
      </dl>

      <ChangeLog diff={diff} titleId={`${uid}-log`} />
    </div>
  );
}

/**
 * A/B comparison dialog. `sources` is null while the cloud library loads;
 * the workspace mounts once it arrives, starting on `baseId` / `targetId`.
 */
export function ProjectDiffModal({ open, onClose, sources, baseId, targetId, returnFocus, title }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  useModalDialog({ open, panelRef, initialFocusRef: closeRef, returnFocus, onClose });

  if (!open) return null;
  const ready = Array.isArray(sources) && sources.length > 0;

  return (
    <div className="modal-root">
      <div className="modal-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Project comparison"
        aria-busy={!ready || undefined}
        data-testid="project-diff-modal"
      >
        <header className="diff-modal__header">
          <div>
            <p className="index-label">
              <span className="index-label__num">A/B</span> / Revision Diff
            </p>
            <h2 className="diff-modal__title">{title}</h2>
          </div>
          <button ref={closeRef} type="button" className="drawer__close" data-testid="close-project-diff" onClick={onClose}>
            Close
          </button>
        </header>
        {ready ? (
          <DiffWorkspace sources={sources} initialBase={baseId} initialTarget={targetId} />
        ) : (
          <div className="diff-loading" role="status" data-testid="diff-loading">
            <span className="diff-loading__bar" aria-hidden="true" />
            <p className="diff-loading__label">Fetching cloud revisions...</p>
          </div>
        )}
      </div>
    </div>
  );
}
