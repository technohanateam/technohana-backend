import { rm } from 'node:fs/promises';

/**
 * Runs once before the whole test run (not per file). Test files intentionally
 * share one FILE_STORE_PATH across the run - deleting it here guarantees a
 * clean slate every `vitest run` regardless of what a previous run left
 * behind, while still letting tests within the run rely on explicit,
 * non-colliding connectionKey values rather than needing full isolation.
 */
export default async function globalSetup(): Promise<void> {
  await rm('./tests/.tmp/test-store.json', { force: true });
}
