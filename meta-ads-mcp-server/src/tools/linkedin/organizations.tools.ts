import { z } from 'zod';
import { createTool } from '../createTool.js';
import { linkedinConnectionKeySchema } from './schemas.js';
import { resolveLinkedInConnectionKey } from './connection.util.js';
import * as organizationsService from '../../providers/linkedin/organizations.service.js';

const listOrganizationsSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
});

export const listOrganizationsTool = createTool({
  name: 'linkedin_list_organizations',
  description: 'Lists LinkedIn organizations (Company Pages) the connected member administers.',
  inputSchema: listOrganizationsSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return organizationsService.listOrganizations(connectionKey);
  },
});

const getOrganizationSchema = z.object({
  connectionKey: linkedinConnectionKeySchema,
  organizationUrn: z.string().describe('Organization URN, e.g. "urn:li:organization:12345" (from list_organizations).'),
});

export const getOrganizationTool = createTool({
  name: 'linkedin_get_organization',
  description: 'Retrieves a single LinkedIn organization by URN.',
  inputSchema: getOrganizationSchema,
  handler: async (input) => {
    const connectionKey = await resolveLinkedInConnectionKey(input.connectionKey);
    return organizationsService.getOrganization(connectionKey, input.organizationUrn);
  },
});

export const organizationsTools = [listOrganizationsTool, getOrganizationTool];
