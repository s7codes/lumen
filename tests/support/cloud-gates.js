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

/**
 * Holds every /api/projects round trip (the account's load, and the sync of a
 * diverged local mirror that can stand in for it) until the returned release
 * is called, so a spec can read the loading state that lasts one round trip
 * without racing it on a loaded machine. Released trips pass through untouched.
 */
export async function holdProjectTrips(page) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/projects**', async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}
