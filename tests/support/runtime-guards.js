export const VIEWPORT_WIDTHS = [360, 768, 1024, 1280, 1600];

export async function installCspRecorder(page) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
}

export function readCspViolations(page) {
  return page.evaluate(() => window.__cspViolations);
}

export function collectRuntimeErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('dialog', (dialog) => {
    errors.push(`dialog: ${dialog.type()} ${dialog.message()}`);
    dialog.dismiss();
  });
  return errors;
}

export function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

export function storeDisplayMode(page, mode) {
  return page.evaluate((value) => localStorage.setItem('lumen:display-mode', JSON.stringify(value)), mode);
}
