/**
 * LinkedIn REST API paths take bare numeric IDs (e.g. `/adAccounts/509...`)
 * while request/response bodies and query params use fully-qualified URNs
 * (e.g. `urn:li:sponsoredAccount:509...`). This codebase always carries the
 * full URN internally (mirroring the `AdProvider` contract) and only strips
 * it down to a bare ID at the point of building a URL path.
 */
export function idFromUrn(urn: string): string {
  return urn.split(':').pop() ?? urn;
}

export function organizationUrn(id: string): string {
  return id.startsWith('urn:li:organization:') ? id : `urn:li:organization:${id}`;
}

export function accountUrn(id: string): string {
  return id.startsWith('urn:li:sponsoredAccount:') ? id : `urn:li:sponsoredAccount:${id}`;
}

export function campaignGroupUrn(id: string): string {
  return id.startsWith('urn:li:sponsoredCampaignGroup:') ? id : `urn:li:sponsoredCampaignGroup:${id}`;
}

export function campaignUrn(id: string): string {
  return id.startsWith('urn:li:sponsoredCampaign:') ? id : `urn:li:sponsoredCampaign:${id}`;
}

export function creativeUrn(id: string): string {
  return id.startsWith('urn:li:sponsoredCreative:') ? id : `urn:li:sponsoredCreative:${id}`;
}
