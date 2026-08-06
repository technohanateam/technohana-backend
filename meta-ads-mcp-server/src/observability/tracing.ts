import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let sdkStarted = false;

/**
 * Bootstraps the OpenTelemetry Node SDK (auto-instrumentation + OTLP trace
 * export) when OTEL_ENABLED=true. No-op otherwise, so tracing is genuinely
 * optional rather than a half-wired dependency.
 *
 * In this ESM project, auto-instrumentation can only patch modules (express,
 * http, etc.) that haven't been imported yet - calling this function from
 * inside server.ts would be too late, since server.ts's own top-level imports
 * (express and friends) are hoisted and resolved before any of its code runs.
 * The correct entry point is `observability/register.ts`, loaded via Node's
 * `--import` preload flag (see package.json's `start` script and the
 * Dockerfile CMD) so it finishes running before dist/server.js is loaded at
 * all.
 */
export async function startTracing(): Promise<void> {
  if (!env.OTEL_ENABLED || sdkStarted) return;

  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME,
    traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  sdkStarted = true;
  logger.info({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT, serviceName: env.OTEL_SERVICE_NAME }, 'otel_tracing_started');

  const shutdown = () => {
    sdk
      .shutdown()
      .catch((error) => logger.error({ err: error }, 'otel_tracing_shutdown_failed'));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
