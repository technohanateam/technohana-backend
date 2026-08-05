import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { env } from '../config/env.js';

export const metricsRegistry = new Registry();

if (env.METRICS_ENABLED) {
  collectDefaultMetrics({ register: metricsRegistry });
}

export const toolInvocationsTotal = new Counter({
  name: 'mcp_tool_invocations_total',
  help: 'Total MCP tool invocations, labeled by tool name and outcome.',
  labelNames: ['tool', 'status'] as const,
  registers: [metricsRegistry],
});

export const toolLatencyMs = new Histogram({
  name: 'mcp_tool_latency_ms',
  help: 'MCP tool invocation latency in milliseconds.',
  labelNames: ['tool'] as const,
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [metricsRegistry],
});

export const metaApiLatencyMs = new Histogram({
  name: 'meta_api_latency_ms',
  help: 'Meta Graph API call latency in milliseconds.',
  labelNames: ['operation'] as const,
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [metricsRegistry],
});

export const toolErrorsTotal = new Counter({
  name: 'mcp_tool_errors_total',
  help: 'Total MCP tool invocation errors, labeled by tool name.',
  labelNames: ['tool'] as const,
  registers: [metricsRegistry],
});

export const metaRateLimitHitsTotal = new Counter({
  name: 'meta_api_rate_limit_hits_total',
  help: 'Total times a Meta Graph API call was retried due to a rate-limit/transient error.',
  registers: [metricsRegistry],
});

/** Records a completed tool invocation into the invocation counter and latency histogram. */
export function recordToolInvocation(tool: string, status: 'success' | 'error', durationMs: number): void {
  if (!env.METRICS_ENABLED) return;
  toolInvocationsTotal.inc({ tool, status });
  toolLatencyMs.observe({ tool }, durationMs);
  if (status === 'error') {
    toolErrorsTotal.inc({ tool });
  }
}
