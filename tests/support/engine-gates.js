// The room planner's WebGL engine: the second lazy chunk behind RoomPlannerPage.
const ENGINE_CHUNK = /\/assets\/RoomCanvas-[\w-]+\.js$/;

/**
 * Holds the next request for the WebGL engine chunk until the returned release
 * is called. Until then the engine cannot report ready, so the studio boot and
 * any replay stay up until Enter Studio Now: a spec can work the overlay
 * without racing its wall-clock hold. The route serves that one request and
 * then removes itself, once the held chunk has been let through.
 */
export async function holdEngineChunk(page) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    ENGINE_CHUNK,
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  return release;
}
