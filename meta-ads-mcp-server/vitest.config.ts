import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Set BEFORE any module (including setupFiles) loads, so config/env.ts's
    // import-time validation never fails during test collection.
    env: {
      NODE_ENV: 'test',
      VITEST: 'true',
      LOG_LEVEL: 'silent',
      MCP_JWT_SECRET: 'test-mcp-jwt-secret-not-for-production',
      MCP_JWT_ISSUER: 'meta-ads-mcp-server-test',
      MCP_JWT_AUDIENCE: 'claude-mcp-connector-test',
      ANTHROPIC_API_KEY: 'test-anthropic-api-key',
      META_APP_ID: 'test-app-id',
      META_APP_SECRET: 'test-app-secret',
      META_OAUTH_REDIRECT_URI: 'http://localhost:3333/auth/meta/callback',
      LINKEDIN_CLIENT_ID: 'test-linkedin-client-id',
      LINKEDIN_CLIENT_SECRET: 'test-linkedin-client-secret',
      LINKEDIN_OAUTH_REDIRECT_URI: 'http://localhost:3333/auth/linkedin/callback',
      STORAGE_BACKEND: 'file',
      FILE_STORE_PATH: './tests/.tmp/test-store.json',
      FILE_STORE_ENCRYPTION_KEY: 'b'.repeat(64),
      CACHE_BACKEND: 'memory',
      METRICS_ENABLED: 'false',
      OTEL_ENABLED: 'false',
    },
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Every test file shares one FILE_STORE_PATH (via `env` above). FileStore's
    // write queue only serializes access within a single process, so running
    // test files in parallel workers would let two files write the same
    // encrypted file concurrently - a real corruption/flakiness risk, not a
    // hypothetical one. Sequential file execution avoids it entirely.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.types.ts', 'src/server.ts'],
    },
    testTimeout: 15000,
  },
});
