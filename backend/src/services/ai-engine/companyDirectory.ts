/**
 * Known companies directory for data enrichment in the AI Scorer.
 * Classifies companies into MNCs, Tier-1 Startups, and Service-based companies.
 */

const MNCS = [
  'google', 'microsoft', 'amazon', 'meta', 'apple', 'netflix', 'oracle',
  'adobe', 'salesforce', 'cisco', 'stripe', 'intel', 'amd', 'nvidia',
  'uber', 'lyft', 'atlassian', 'github', 'airbnb', 'spotify', 'paypal',
  'zoom', 'coinbase', 'snowflake', 'databricks', 'honeywell', 'samsung',
  'goldman sachs', 'morgan stanley', 'j.p. morgan', 'jp morgan', 'walmart',
  'stripe', 'figma', 'notion', 'cloudflare', 'shopify', 'datadog', 'hashicorp'
];

const TIER_1_STARTUPS = [
  'razorpay', 'cred', 'zepto', 'meesho', 'zomato', 'swiggy', 'flipkart',
  'phonepe', 'groww', 'sharechat', 'browserstack', 'ola', 'urban company',
  'dunzo', 'slice', 'inmobi', 'paytm', 'delhivery', 'nykaa', 'blinkit',
  'ola electric', 'lenskart', 'unacademy', 'upgrad', 'cars24', 'byjus',
  'swiggy instamart', 'pocket aces', 'postman', 'hasura', 'atlassian'
];

const SERVICE_COMPANIES = [
  'infosys', 'tcs', 'tata consultancy', 'wipro', 'capgemini', 'accenture',
  'cognizant', 'tech mahindra', 'hcl', 'mindtree', 'ltimindtree', 'mphasis',
  'hexaware', 'niit', 'ibm', 'hp', 'ust global', 'cts', 'ey', 'deloitte',
  'pwc', 'kpmg', 'genpact', 'syntel', 'l&t infotech', 'lti'
];

export type CompanyStatus = 'MNC' | 'TIER_1_STARTUP' | 'SERVICE' | 'UNKNOWN';

export function getCompanyStatus(companyName: string): CompanyStatus {
  if (!companyName) return 'UNKNOWN';
  const lower = companyName.toLowerCase().trim();

  if (MNCS.some((m) => lower.includes(m))) {
    return 'MNC';
  }
  if (TIER_1_STARTUPS.some((t) => lower.includes(t))) {
    return 'TIER_1_STARTUP';
  }
  if (SERVICE_COMPANIES.some((s) => lower.includes(s))) {
    return 'SERVICE';
  }

  return 'UNKNOWN';
}
