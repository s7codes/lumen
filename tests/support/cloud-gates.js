/**
 * Holds every POST /api/projects until the returned release is called, so a
 * spec can inspect the pending save state without racing its 500 ms window
 * when the machine is loaded. Released saves pass through untouched.
 */
export async function holdProjectSaves(page) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  return release;
}
