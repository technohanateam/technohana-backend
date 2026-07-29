// Shared Bull/ioredis connection config. Prefers REDIS_URL (what managed
// providers like Railway typically expose) and falls back to discrete
// REDIS_HOST/PORT/PASSWORD vars for local/manual setups.
let redisConfig;

if (process.env.REDIS_URL) {
  redisConfig = process.env.REDIS_URL;
  console.log("[redis] using REDIS_URL");
} else {
  redisConfig = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
  };
  if (process.env.REDIS_PASSWORD) redisConfig.password = process.env.REDIS_PASSWORD;
  console.log(`[redis] using REDIS_HOST/PORT (${redisConfig.host}:${redisConfig.port})`);
}

export { redisConfig };
