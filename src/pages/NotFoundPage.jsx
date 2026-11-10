import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from '../components/icons.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { sanitizeText } from '../security/sanitize.js';

export default function NotFoundPage() {
  useDocumentTitle('Not found');
  const { pathname } = useLocation();
  const path = sanitizeText(pathname, { maxLength: 80 });

  return (
    <>
      <PageHeader
        index="00"
        section="Not found"
        title="No view at this address."
        lede={`Nothing is mounted at ${path}.`}
      />
      <div className="container">
        <Link to="/" className="button">
          Back to overview
          <ArrowRight />
        </Link>
      </div>
    </>
  );
}
