import type { McpToolDefinition } from '../../types/mcp.types.js';
import { organizationsTools } from './organizations.tools.js';
import { accountsTools } from './accounts.tools.js';
import { campaignGroupsTools } from './campaignGroups.tools.js';
import { campaignsTools } from './campaigns.tools.js';

/** Every LinkedIn Ads MCP tool, aggregated for registration in tools/index.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const linkedinTools: McpToolDefinition<any>[] = [
  ...organizationsTools,
  ...accountsTools,
  ...campaignGroupsTools,
  ...campaignsTools,
];
