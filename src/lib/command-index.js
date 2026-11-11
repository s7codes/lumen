import { PRODUCTS } from '../data/products.js';
import { MODE_LABELS } from './display-mode.js';
import { formatUsd } from './format.js';
import { CURRENCIES } from './quote.js';
import { sanitizeText } from '../security/sanitize.js';

export const QUERY_MAX = 64;

export const WORKSPACES = Object.freeze([
  { id: 'ws-overview', label: 'Overview', path: '/', keywords: 'home index start lumen' },
  { id: 'ws-catalog', label: 'Catalog', path: '/catalog', keywords: 'parts products modules index browse' },
  { id: 'ws-room', label: '3D Room Planner', path: '/room-3d', keywords: 'room planner webgl spatial 3d obj' },
  { id: 'ws-studio', label: '2D Wall Studio', path: '/studio-2d', keywords: 'wall studio elevation 2d layout' },
  { id: 'ws-checkout', label: 'Project Quote', path: '/checkout', keywords: 'checkout quote requisition bom' },
  { id: 'ws-account', label: 'Account', path: '/account', keywords: 'account profile projects library orders' },
]);

export const GROUPS = Object.freeze([
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'modules', label: 'Modules' },
  { id: 'commands', label: 'Commands' },
]);

/**
 * Every palette entry for the current context. `action` is plain data the
 * palette executes; nothing here touches React, the router or storage.
 */
export function buildCommandIndex({ mode, currency, signedIn }) {
  const workspaces = WORKSPACES.map((entry) => ({
    id: entry.id,
    group: 'workspaces',
    label: entry.label,
    detail: entry.path,
    meta: entry.path === '/account' && !signedIn ? 'Sign in' : '',
    badge: entry.path === '/account' && !signedIn,
    keywords: `${entry.path} ${entry.keywords}`,
    action: entry.path === '/account' && !signedIn ? { type: 'sign-in' } : { type: 'navigate', path: entry.path },
    prefetch: entry.path,
  }));

  const modules = PRODUCTS.map((product) => ({
    id: `module-${product.id}`,
    group: 'modules',
    label: product.name,
    detail: product.sku,
    meta: `${product.watts} W / ${formatUsd(product.priceUsd)}`,
    keywords: `${product.sku} ${product.id} ${product.category} ${product.watts}w module part`,
    action: { type: 'navigate', path: `/catalog/${product.id}` },
  }));

  const nextMode = mode === 'technical' ? 'architectural' : 'technical';
  const modeLabel = MODE_LABELS[nextMode];
  const commands = [
    {
      id: 'cmd-mode',
      group: 'commands',
      label: `Switch to ${modeLabel} Mode`,
      detail: 'Display mode',
      meta: '',
      keywords: 'mode display view toggle visual specs technical architectural tech arch',
      action: { type: 'mode', mode: nextMode },
    },
    ...CURRENCIES.map((entry) => ({
      id: `cmd-currency-${entry.code.toLowerCase()}`,
      group: 'commands',
      label: `Set Currency: ${entry.code}`,
      detail: entry.label,
      meta: entry.code === currency ? 'Current' : '',
      badge: entry.code === currency,
      keywords: `currency money price quote ${entry.code} ${entry.label}`,
      action: { type: 'currency', code: entry.code },
    })),
    {
      id: 'cmd-cart',
      group: 'commands',
      label: 'Open Cart Drawer',
      detail: 'Cart',
      meta: '',
      keywords: 'cart bag drawer basket lines',
      action: { type: 'cart' },
    },
  ];

  return [...workspaces, ...modules, ...commands].map((entry) => ({
    ...entry,
    labelText: entry.label.toLowerCase(),
    haystack: `${entry.label} ${entry.detail} ${entry.keywords}`.toLowerCase(),
  }));
}

export function normalizeQuery(value) {
  return sanitizeText(value, { maxLength: QUERY_MAX }).toLowerCase();
}

// Label prefix beats a word start in the label, which beats a substring;
// keywords only qualify an entry. Every term has to land somewhere.
function score(entry, terms) {
  let total = 0;
  for (const term of terms) {
    if (entry.labelText.startsWith(term)) total += 8;
    else if (entry.labelText.includes(` ${term}`)) total += 4;
    else if (entry.labelText.includes(term)) total += 2;
    else if (entry.haystack.includes(term)) total += 1;
    else return 0;
  }
  return total;
}

/** Filters and ranks within each group; groups keep their fixed order and empty ones drop out. */
export function searchCommands(index, query) {
  const terms = normalizeQuery(query).split(' ').filter(Boolean);
  return GROUPS.map((group) => {
    const entries = index.filter((entry) => entry.group === group.id);
    if (terms.length === 0) return { ...group, entries };
    const ranked = entries
      .map((entry, order) => ({ entry, order, rank: score(entry, terms) }))
      .filter(({ rank }) => rank > 0)
      .sort((a, b) => b.rank - a.rank || a.order - b.order)
      .map(({ entry }) => entry);
    return { ...group, entries: ranked };
  }).filter((group) => group.entries.length > 0);
}
