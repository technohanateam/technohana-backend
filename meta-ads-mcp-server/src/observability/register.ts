// OpenTelemetry preload entry point. Load this BEFORE the main server module
// via Node's `--import` flag (`node --import ./dist/observability/register.js
// dist/server.js`) - loading it any other way means auto-instrumentation
// attaches too late to patch express/http, since a module already imported
// elsewhere can no longer be instrumented after the fact.
import { startTracing } from './tracing.js';

await startTracing();
