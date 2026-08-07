import { updateCampaign } from './campaigns.service.js';
import type { LinkedInCampaign } from '../../types/linkedin.types.js';

/** Updates a campaign's daily and/or total budget. Thin wrapper over campaigns.service.updateCampaign so budget tools have a focused entry point. */
export async function updateBudget(
  connectionKey: string,
  campaignUrn: string,
  budget: { dailyBudgetAmount?: number; totalBudgetAmount?: number },
): Promise<LinkedInCampaign> {
  return updateCampaign(connectionKey, campaignUrn, {
    dailyBudgetAmount: budget.dailyBudgetAmount,
    totalBudgetAmount: budget.totalBudgetAmount,
  });
}

/** Updates a campaign's bid (unit cost) amount. */
export async function updateBid(connectionKey: string, campaignUrn: string, unitCostAmount: number): Promise<LinkedInCampaign> {
  return updateCampaign(connectionKey, campaignUrn, { unitCostAmount });
}
