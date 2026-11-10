import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader.jsx';
import { ProductCard } from '../components/ProductCard.jsx';
import { CATEGORIES, CATEGORY_IDS, FINISHES, PRODUCTS } from '../data/products.js';
import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { padIndex } from '../lib/format.js';
import { isOneOf, sanitizeText } from '../security/sanitize.js';
import '../styles/pages.css';

const FILTERS = [{ id: 'all', label: 'All' }, ...CATEGORIES];

const SORTS = [
  { id: 'index', label: 'Index', compare: (a, b) => a.order - b.order },
  { id: 'price-asc', label: 'Price, low to high', compare: (a, b) => a.priceUsd - b.priceUsd },
  { id: 'price-desc', label: 'Price, high to low', compare: (a, b) => b.priceUsd - a.priceUsd },
  { id: 'load-desc', label: 'Load, high to low', compare: (a, b) => b.watts - a.watts },
  { id: 'name', label: 'Name, A to Z', compare: (a, b) => a.name.localeCompare(b.name, 'en') },
];
const SORT_IDS = SORTS.map((sort) => sort.id);
const QUERY_MAX = 64;

const INDEXED = PRODUCTS.map((product, i) => ({
  ...product,
  order: i + 1,
  haystack: [
    product.name,
    product.sku,
    product.category,
    product.summary,
    ...product.finishes.map((id) => FINISHES.find((f) => f.id === id)?.name ?? ''),
  ]
    .join(' ')
    .toLowerCase(),
}));

const COUNTS = new Map(
  FILTERS.map((filter) => [
    filter.id,
    filter.id === 'all' ? PRODUCTS.length : PRODUCTS.filter((p) => p.category === filter.id).length,
  ]),
);

function readCategory(params) {
  const value = params.get('category');
  return isOneOf(value, CATEGORY_IDS) ? value : 'all';
}

export default function CatalogPage() {
  useDocumentTitle('Catalog');
  const [mode] = useDisplayMode();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('index');
  const [finishes, setFinishes] = useState(() => new Map());
  const reveal = useScrollReveal();

  const category = readCategory(params);
  const needle = sanitizeText(query, { maxLength: QUERY_MAX }).toLowerCase();

  const results = useMemo(() => {
    const { compare } = SORTS.find((s) => s.id === sort) ?? SORTS[0];
    return INDEXED.filter(
      (product) =>
        (category === 'all' || product.category === category) &&
        (needle === '' || product.haystack.includes(needle)),
    ).sort(compare);
  }, [category, needle, sort]);

  const selectCategory = (id) => {
    setParams(id === 'all' ? {} : { category: id }, { replace: true, preventScrollReset: true });
  };

  const selectFinish = (productId, finishId) => {
    setFinishes((prev) => new Map(prev).set(productId, finishId));
  };

  const resetFilters = () => {
    setQuery('');
    setSort('index');
    selectCategory('all');
  };

  return (
    <>
      <PageHeader
        index="02"
        section="Catalog"
        title="Catalog"
        lede="Fixtures, shelving, surfaces and bus hardware in one index. Every part lists its dimensions, output and load on the 24V bus."
        meta={[
          ['Items', padIndex(PRODUCTS.length, 3)],
          ['Families', padIndex(CATEGORIES.length)],
          ['Bus', '24V DC'],
        ]}
      />

      <div className="catalog container">
        <div className="catalog__controls">
          <div className="catalog-filter" role="group" aria-label="Category">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className="catalog-filter__option"
                aria-pressed={category === filter.id}
                onClick={() => selectCategory(filter.id)}
              >
                <span>{filter.label}</span>
                <span className="catalog-filter__count">{padIndex(COUNTS.get(filter.id))}</span>
              </button>
            ))}
          </div>

          <div className="catalog__tools">
            <label className="field field--search">
              <span className="field__label">Search</span>
              <input
                className="field__input"
                type="search"
                value={query}
                maxLength={QUERY_MAX}
                placeholder="Name, SKU or finish"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value.slice(0, QUERY_MAX))}
              />
            </label>
            <label className="field">
              <span className="field__label">Sort</span>
              <select
                className="field__input field__select"
                value={sort}
                onChange={(event) => {
                  if (isOneOf(event.target.value, SORT_IDS)) setSort(event.target.value);
                }}
              >
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <section className="catalog__results" aria-labelledby="catalog-results-title">
          <h2 id="catalog-results-title" className="visually-hidden">
            Products
          </h2>
          <div className="catalog__toolbar mono">
            <span data-testid="catalog-count" aria-live="polite">
              {padIndex(results.length)} {results.length === 1 ? 'result' : 'results'}
            </span>
            <span>{mode === 'technical' ? 'Technical / telemetry' : 'Architectural / finish'}</span>
          </div>

          {results.length > 0 ? (
            <ul className="product-grid reveal-stagger">
              {results.map((product) => (
                <li key={product.id} ref={reveal} className="product-grid__cell reveal-cinematic">
                  <ProductCard
                    product={product}
                    index={product.order}
                    finishId={finishes.get(product.id)}
                    onFinishChange={selectFinish}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="catalog__empty">
              <p className="catalog__empty-title">No modules match {needle ? `"${needle}"` : 'this filter'}.</p>
              <button type="button" className="button" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
