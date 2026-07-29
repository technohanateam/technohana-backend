// Shared Bull/ioredis connection config. Prefers REDIS_URL (what managed
// providers like Railway typically expose) and falls back to discrete
// REDIS_HOST/PORT/PASSWORD vars for local/manual setups.
let redisConfig;

// Capped exponential backoff so a Redis restart/failover is retried instead
// of the connection being abandoned (ioredis's default is already
// unbounded retry, but we log so restarts are visible in Railway logs
// rather than failing silently, and cap the delay at 10s).
function retryStrategy(times) {
  const delay = Math.min(times * 500, 10000);
  console.warn(`[redis] connection retry #${times}, retrying in ${delay}ms`);
  return delay;
}

if (process.env.REDIS_URL) {
  // ioredis's object-form constructor doesn't understand a "url" key, so
  // the URL is parsed into discrete fields rather than passed through raw
  // — passing it as-is would silently fall back to localhost.
  const parsed = new URL(process.env.REDIS_URL);
  redisConfig = {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    retryStrategy,
    // Bull opens extra internal connections (a blocking client for
    // BRPOPLPUSH, a subscriber) that must retry indefinitely rather than
    // give up after ioredis's default cap of 20 queued-command retries —
    // otherwise a slow handshake or brief reconnect throws "max retries
    // per request" and the queue never reaches "ready".
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  if (parsed.username) redisConfig.username = decodeURIComponent(parsed.username);
  if (parsed.password) redisConfig.password = decodeURIComponent(parsed.password);
  if (parsed.protocol === "rediss:") redisConfig.tls = {};
  console.log(`[redis] using REDIS_URL (${parsed.hostname}:${redisConfig.port})`);
} else {
  redisConfig = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    retryStrategy,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  if (process.env.REDIS_PASSWORD) redisConfig.password = process.env.REDIS_PASSWORD;
  console.log(`[redis] using REDIS_HOST/PORT (${redisConfig.host}:${redisConfig.port})`);
}

export { redisConfig };
