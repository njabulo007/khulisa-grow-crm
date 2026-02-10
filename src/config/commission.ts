const normalizeEmail = (value?: string | null): string => (value || '').trim().toLowerCase();

export const SPECIAL_AGENT_EMAIL = 'njabulo@gmail.com';
export const SPECIAL_AGENT_RATE = 0.3;
export const BASE_AGENT_RATE = 0.15;
export const UPGRADED_AGENT_RATE = 0.2;
export const SALES_THRESHOLD_FOR_UPGRADED_RATE = 6;

// Legacy fallback used when historical records have no explicit rate.
export const COMMISSION_RATE = BASE_AGENT_RATE;

export const isSpecialCommissionAgentEmail = (email?: string | null): boolean =>
  normalizeEmail(email) === SPECIAL_AGENT_EMAIL;

export const getCommissionRateForAgent = (params: {
  agentEmail?: string | null;
  paidSalesCount: number;
}): number => {
  if (isSpecialCommissionAgentEmail(params.agentEmail)) {
    return SPECIAL_AGENT_RATE;
  }
  return params.paidSalesCount > SALES_THRESHOLD_FOR_UPGRADED_RATE ? UPGRADED_AGENT_RATE : BASE_AGENT_RATE;
};

export const getDefaultCommissionRateForAgent = (agentEmail?: string | null): number =>
  isSpecialCommissionAgentEmail(agentEmail) ? SPECIAL_AGENT_RATE : BASE_AGENT_RATE;

export const getDefaultCommissionRatePercentForAgent = (agentEmail?: string | null): number =>
  Math.round(getDefaultCommissionRateForAgent(agentEmail) * 100);

export const formatCommissionRatePercent = (rate: number): string =>
  `${Math.round(rate * 100)}%`;
