/**
 * Sample quote archive for the account dashboard. Static records until the
 * order API in server/ serves real requisitions; amounts are gross USD.
 */
export const ORDER_HISTORY = Object.freeze([
  {
    quoteId: 'LMN-Q-20261021-4K9Q2T',
    requisition: 'LMN-R-7F3A91C2',
    date: '2026-10-21',
    project: 'Atelier Vesterbro, reading wall',
    lines: 6,
    loadW: 108,
    grossUsd: 1798,
    status: 'In production',
  },
  {
    quoteId: 'LMN-Q-20260904-0BX7LM',
    requisition: 'LMN-R-2C84D0EE',
    date: '2026-09-04',
    project: 'Studio Norrebro, desk niche',
    lines: 4,
    loadW: 46,
    grossUsd: 912,
    status: 'Delivered',
  },
  {
    quoteId: 'LMN-Q-20260712-9RWQ0D',
    requisition: null,
    date: '2026-07-12',
    project: 'Bedroom 2, headboard wall',
    lines: 3,
    loadW: 32,
    grossUsd: 655,
    status: 'Quote expired',
  },
]);
