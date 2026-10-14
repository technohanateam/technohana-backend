import 'dotenv/config';
import mongoose from 'mongoose';
import { refreshPriceCatalog } from '../src/utils/pricing.js';
import { createApp } from './app.js';

const uri = process.env.MONGO_DB_READONLY;
if (!uri) {
  console.error('MONGO_DB_READONLY is required');
  process.exit(1);
}

// autoIndex/autoCreate off: this process connects with a read-only user and
// must never try to create collections or indexes.
await mongoose.connect(uri, { autoIndex: false, autoCreate: false, maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
await refreshPriceCatalog();
setInterval(() => refreshPriceCatalog().catch((err) => console.error('[public-mcp] catalog refresh failed:', err?.name)), 5 * 60 * 1000).unref();

const port = Number(process.env.PORT) || 3400;
createApp().listen(port, () => console.log(`[public-mcp] listening on ${port}`));
