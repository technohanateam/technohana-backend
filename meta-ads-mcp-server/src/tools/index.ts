import type { McpToolDefinition } from '../types/mcp.types.js';
import { accountsTools } from './accounts.tools.js';
import { campaignsTools } from './campaigns.tools.js';
import { adsetsTools } from './adsets.tools.js';
import { adsTools } from './ads.tools.js';
import { mediaTools } from './media.tools.js';
import { insightsTools } from './insights.tools.js';
import { leadsTools } from './leads.tools.js';
import { pixelTools } from './pixel.tools.js';
import { aiTools } from './ai.tools.js';

/** Every MCP tool this server exposes, aggregated for registration in mcp.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allTools: McpToolDefinition<any>[] = [
  ...accountsTools,
  ...campaignsTools,
  ...adsetsTools,
  ...adsTools,
  ...mediaTools,
  ...insightsTools,
  ...leadsTools,
  ...pixelTools,
  ...aiTools,
];
