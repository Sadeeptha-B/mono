/**
 * The one way Mono makes an id.
 *
 * Shared by the session store and the task store, which are the only two
 * places allowed to make one. Random rather than sequential, and generated on
 * the client, so two copies of the backlog that never spoke to each other can
 * still be merged one day without renumbering anything.
 */
export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
