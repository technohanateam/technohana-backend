import { Router } from 'express';
import axios from 'axios';
import { META_GRAPH_BASE_URL } from '../config/constants.js';
import { getStorageAdapter } from '../storage/storage.factory.js';
import { listConnections } from '../auth/tokenManager.js';
import { logger } from '../utils/logger.js';

export const readyRouter = Router();

async function checkMetaApiReachable(): Promise<boolean> {
  try {
    // Any response under 500 (even a Meta error body for an unauthenticated
    // request) proves DNS/TLS/routing to the Graph API works; we only care
    // about reachability here, not authenticated success.
    await axios.get(META_GRAPH_BASE_URL, { timeout: 3000, validateStatus: (status) => status < 500 });
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'ready_check_meta_api_unreachable');
    return false;
  }
}

async function checkStorageReachable(): Promise<boolean> {
  try {
    await getStorageAdapter().ping();
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'ready_check_storage_unreachable');
    return false;
  }
}

/**
 * Readiness probe. Storage and Meta API reachability gate the 200/503 status,
 * since those reflect genuine infrastructure health. Whether a Meta account
 * has been connected yet is reported for visibility but never gates
 * readiness - a freshly deployed instance legitimately has zero connections
 * until someone completes /auth/meta/login, and that isn't a failure state.
 */
readyRouter.get('/ready', async (_req, res) => {
  const [metaApiReachable, storageReachable, connections] = await Promise.all([
    checkMetaApiReachable(),
    checkStorageReachable(),
    listConnections().catch(() => []),
  ]);

  const checks = {
    storageReachable,
    metaApiReachable,
    hasMetaConnection: connections.length > 0,
  };

  const ready = storageReachable && metaApiReachable;
  res.status(ready ? 200 : 503).json({ success: ready, checks });
});
