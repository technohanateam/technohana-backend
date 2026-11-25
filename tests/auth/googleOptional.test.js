import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import passport from "passport";

const withEnv = async (env, fn) => {
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  for (const [k, v] of Object.entries({ GOOGLE_CLIENT_ID: env.id, GOOGLE_CLIENT_SECRET: env.secret })) {
    // Empty (not deleted): passport.js calls dotenv, which would refill a deleted variable from a local .env.
    process.env[k] = v ?? "";
  }
  try { return await fn(); } finally {
    for (const [k, v] of [["GOOGLE_CLIENT_ID", saved.id], ["GOOGLE_CLIENT_SECRET", saved.secret]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
};

test("the server can load the passport config with no Google credentials", async () => {
  await withEnv({}, async () => {
    const mod = await import("../../src/config/passport.js?no-creds");
    assert.equal(mod.isGoogleLoginConfigured(), false);
    assert.equal(passport._strategy("google"), undefined, "no strategy is registered");
  });
});

test("an id without a secret (or the reverse) counts as not configured", async () => {
  await withEnv({ id: "only-id" }, async () => {
    const mod = await import("../../src/config/passport.js?id-only");
    assert.equal(mod.isGoogleLoginConfigured(), false);
  });
  await withEnv({ secret: "only-secret" }, async () => {
    const mod = await import("../../src/config/passport.js?secret-only");
    assert.equal(mod.isGoogleLoginConfigured(), false);
  });
});

test("with both set, the Google strategy is registered", async () => {
  await withEnv({ id: "client-id", secret: "client-secret" }, async () => {
    const mod = await import("../../src/config/passport.js?with-creds");
    assert.equal(mod.isGoogleLoginConfigured(), true);
    assert.ok(passport._strategy("google"), "strategy is registered");
  });
  passport.unuse("google");
});

test("the Google routes answer 503 instead of crashing when it is not configured", async () => {
  await withEnv({}, async () => {
    const { default: router } = await import("../../src/routes/auth.routes.js");
    const app = express();
    app.use(router);
    const server = http.createServer(app).listen(0);
    try {
      const { port } = server.address();
      for (const path of ["/api/auth/google", "/api/auth/google/callback"]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" });
        assert.equal(res.status, 503, path);
        assert.match((await res.json()).message, /not configured/i);
      }
    } finally {
      server.close();
    }
  });
});
