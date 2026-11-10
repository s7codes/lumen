import { PageHeader } from '../components/PageHeader.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import '../styles/pages.css';

const FILTER_GROUPS = ['Family', 'Finish', 'Output', 'Mounting'];
const SLOTS = Array.from({ length: 8 }, (_, i) => String(i + 1).padStart(2, '0'));

export default function CatalogPage() {
  useDocumentTitle('Catalog');

  return (
    <>
      <PageHeader
        index="02"
        section="Catalog"
        title="Catalog"
        lede="Fixtures, rails, shelving and drivers in one index. Every part lists its dimensions, output and load on the bus."
        meta={[
          ['Items', '000'],
          ['Families', '04'],
          ['Index', 'Pending'],
        ]}
      />

      <div className="catalog container">
        <aside className="catalog__filters" aria-label="Filters">
          <p className="index-label">Filters</p>
          {FILTER_GROUPS.map((group) => (
            <div key={group} className="catalog__filter-group">
              <p className="catalog__filter-name">{group}</p>
              <p className="catalog__filter-empty mono">--</p>
            </div>
          ))}
        </aside>

        <section className="catalog__results" aria-label="Products">
          <div className="catalog__toolbar mono">
            <span>000 results</span>
            <span>Sort / Index</span>
          </div>
          <ul className="catalog__grid">
            {SLOTS.map((slot) => (
              <li key={slot} className="catalog-slot">
                <span className="catalog-slot__code mono">Slot {slot}</span>
                <span className="catalog-slot__mark" aria-hidden="true" />
                <span className="catalog-slot__meta mono" aria-hidden="true">
                  <span>--</span>
                  <span>-- W</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
