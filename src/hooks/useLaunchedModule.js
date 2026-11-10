import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getFinish, getProduct } from '../data/products.js';

const UID_PATTERN = /^m[1-9]\d{0,5}$/;

/**
 * A product page hands the new module's uid over in history state. The planner
 * selects it and announces the mount once, then drops the state so a reload
 * does not repeat the notice. Anything but a uid present in `items` is ignored.
 */
export function useLaunchedModule(items, actions) {
  const location = useLocation();
  const navigate = useNavigate();
  const uid = location.state?.launchedUid;

  useEffect(() => {
    if (typeof uid !== 'string' || !UID_PATTERN.test(uid)) return;
    const item = items.find((entry) => entry.uid === uid);
    if (item) {
      const product = getProduct(item.productId);
      const finish = getFinish(item.finish);
      actions.select(uid);
      actions.announce(`${product.name}, ${finish.label} mounted from the product page.`, 'info');
    }
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null, preventScrollReset: true });
  }, [uid]);
}
