import { afterAll, afterEach, beforeAll } from 'vitest';
import { setupServer } from 'msw/node';

/**
 * Shared MSW server for mocking the Meta Graph API in integration tests.
 * Individual test files register handlers via `mswServer.use(...)`.
 *
 * `onUnhandledRequest: 'bypass'` (not 'error'): this suite also drives its own
 * local Express app through supertest, which issues real loopback HTTP
 * requests that MSW's node interceptor sees too. Those aren't Meta API calls
 * and were never meant to be mocked, so unhandled requests must pass through
 * rather than fail the test. Tests that exercise the Meta API path are
 * expected to register explicit handlers for it themselves.
 */
export const mswServer = setupServer();

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  mswServer.resetHandlers();
});

afterAll(() => {
  mswServer.close();
});
