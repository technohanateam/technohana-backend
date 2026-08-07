import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import { ROLES, isToolAllowedForRole } from '../../src/config/roles.js';

describe('tool registry', () => {
  it('registers exactly 106 tools', () => {
    expect(allTools).toHaveLength(106);
  });

  it('has no duplicate tool names', () => {
    const names = allTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has a non-empty description', () => {
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('every tool has a valid Zod input schema', () => {
    for (const tool of allTools) {
      expect(typeof tool.inputSchema.safeParse).toBe('function');
    }
  });

  it('no tool is orphaned from the RBAC matrix (unreachable by every role)', () => {
    const orphaned = allTools.filter((tool) => !ROLES.some((role) => isToolAllowedForRole(role, tool.name)));
    expect(orphaned.map((tool) => tool.name)).toEqual([]);
  });

  it('admin can invoke every registered tool', () => {
    const unreachableForAdmin = allTools.filter((tool) => !isToolAllowedForRole('admin', tool.name));
    expect(unreachableForAdmin.map((tool) => tool.name)).toEqual([]);
  });

  it('viewer can only invoke read-only tools', () => {
    const viewerAllowed = allTools.filter((tool) => isToolAllowedForRole('viewer', tool.name)).map((t) => t.name);
    expect(viewerAllowed.sort()).toEqual(
      [
        'list_ad_accounts',
        'list_businesses',
        'list_campaigns',
        'list_ad_sets',
        'list_ads',
        'list_asset_library',
        'list_pixels',
        'linkedin_list_organizations',
        'linkedin_get_organization',
        'linkedin_list_ad_accounts',
        'linkedin_get_ad_account',
        'linkedin_list_campaign_groups',
        'linkedin_list_campaigns',
        'linkedin_list_creatives',
        'linkedin_list_media_library',
        'linkedin_validate_asset',
        'linkedin_estimate_audience',
      ].sort(),
    );
  });
});
