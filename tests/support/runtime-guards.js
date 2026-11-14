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

/**
 * Responses the server answered with 4xx or 5xx. An aborted request (a film
 * paused mid-range, a navigation) is not a failure and is not listed.
 */
export function collectFailedResponses(page) {
  const failed = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  return failed;
}

/** Decoded size of an <img>, or 0 until it has loaded. */
export function decodedWidth(img) {
  return img.evaluate((el) => (el.complete ? el.naturalWidth : 0));
}

/** Current playback time of a <video>. */
export function playhead(video) {
  return video.evaluate((el) => el.currentTime);
}

/**
 * A media URL from src/lib/media-manifest.js as a pattern that ignores its
 * release query: Node reads ?v=dev, the build stamps the package version.
 */
export function mediaPath(url) {
  const path = url.split('?')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${path}\\?v=[\\w.-]+$`);
}
