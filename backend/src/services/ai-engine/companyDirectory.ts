import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';
import { flashModel, callWithRetry } from '../../core/gemini';

export type CompanyStatus = 'MNC' | 'TIER_1_STARTUP' | 'SERVICE' | 'UNKNOWN';

/**
 * Classifies a company into MNC, TIER_1_STARTUP, SERVICE, or UNKNOWN.
 * 
 * 1. Checks user settings lists.
 * 2. Checks local DB cache table.
 * 3. Asks Gemini AI to classify and caches the result.
 */
export async function getOrClassifyCompanyStatus(
  companyName: string,
  mncList: string[],
  startupList: string[],
  serviceList: string[]
): Promise<CompanyStatus> {
  if (!companyName) return 'UNKNOWN';
  const lower = companyName.toLowerCase().trim();

  // ── 1. Check user Settings lists from DB ────────────────────────────────────
  if (mncList.some((m) => lower.includes(m.toLowerCase()))) {
    return 'MNC';
  }
  if (startupList.some((t) => lower.includes(t.toLowerCase()))) {
    return 'TIER_1_STARTUP';
  }
  if (serviceList.some((s) => lower.includes(s.toLowerCase()))) {
    return 'SERVICE';
  }

  // ── 2. Check database CompanyTier Cache ─────────────────────────────────────
  try {
    const cached = await prisma.companyTier.findUnique({
      where: { name: companyName.trim() },
    });
    if (cached) {
      return cached.tier as CompanyStatus;
    }
  } catch (cacheErr) {
    logger.warn('Failed to query company tier cache from DB', { error: cacheErr });
  }

  // ── 3. Fallback: Ask Gemini to classify ─────────────────────────────────────
  try {
    const prompt = `Classify the company "${companyName}" into one of these tiers based on its engineering culture, prestige, and scale in the tech industry:
- 'MNC': Large global engineering-first tech multinational (e.g. Google, Microsoft, Samsung, Stripe, Netflix, Amazon, NVIDIA, AMD).
- 'TIER_1_STARTUP': High-growth, well-funded product startup or tech unicorn (e.g. Razorpay, CRED, Zepto, Zomato, Swiggy).
- 'SERVICE': IT consulting, outsourcing, or software services firm (e.g. Infosys, TCS, Wipro, Accenture, Cognizant, Capgemini).
- 'UNKNOWN': Unrecognized, early-stage, or non-tech business.

Respond with ONLY one of the string values: MNC, TIER_1_STARTUP, SERVICE, or UNKNOWN. Do not include markdown formatting or extra text.`;

    logger.info(`Classifying unrecognized company "${companyName}" via Gemini...`);
    const result = await callWithRetry(
      () => flashModel.generateContent(prompt),
      3,
      `classifyCompany:${companyName}`
    );
    const responseText = result.response.text().trim().toUpperCase();
    
    let tier: CompanyStatus = 'UNKNOWN';
    if (responseText.includes('MNC')) {
      tier = 'MNC';
    } else if (responseText.includes('TIER_1_STARTUP') || responseText.includes('STARTUP')) {
      tier = 'TIER_1_STARTUP';
    } else if (responseText.includes('SERVICE')) {
      tier = 'SERVICE';
    }

    // Cache the classification
    await prisma.companyTier.upsert({
      where: { name: companyName.trim() },
      create: { name: companyName.trim(), tier },
      update: { tier },
    }).catch((err) => logger.warn(`Failed to save company tier classification for ${companyName} to DB`, { err }));

    logger.info(`✅ Classified company "${companyName}" as ${tier} and saved to cache`);
    return tier;
  } catch (err) {
    logger.warn(`Failed to classify company "${companyName}" via Gemini, defaulting to UNKNOWN`, { error: err });
    return 'UNKNOWN';
  }
}
