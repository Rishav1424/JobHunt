import { JobSource, JobListing, ScraperQuery } from './base';
import { AdzunaScraper } from './adzuna';
import { RemoteOKScraper } from './remoteok';
import { WellfoundScraper } from './wellfound';
import { InstaHyreScraper } from './instahyre';
import { LinkedInScraper } from './linkedin';
import { NaukriScraper } from './naukri';
import { ATSScraper } from './ats';
import { YCombinatorScraper } from './ycombinator';
import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';
import { canRun, recordSuccess, recordFailure } from '../../core/scraperHealth';
import crypto from 'crypto';
import { SalaryType } from '@prisma/client';
import { refineAndScoreJob } from '../ai-engine/jobRefiner';
import { generateEmbedding } from '../../core/gemini';

export const ALL_SCRAPERS: Record<string, JobSource> = {
  adzuna: new AdzunaScraper(),
  remoteok: new RemoteOKScraper(),
  wellfound: new WellfoundScraper(),
  instahyre: new InstaHyreScraper(),
  linkedin: new LinkedInScraper(),
  naukri: new NaukriScraper(),
  ats: new ATSScraper(),
  ycombinator: new YCombinatorScraper(),
};

// ─── Pre-filter: Title Blocklist ──────────────────────────────────────────────
// Jobs whose titles match any of these are discarded BEFORE hitting the DB/Gemini.
// This saves ~40% of Gemini quota and keeps the dashboard clean.
const TITLE_BLOCKLIST_PATTERNS = [
  /\bmarketing\b/i, /\bsales\b/i, /\bhr\b/i, /\bhuman.?resource/i,
  /\bfinance\b/i, /\baccountant\b/i, /\bcontent.?writer\b/i,
  /\bdata.?entry\b/i, /\bseo\b/i, /\bgraphic.?design/i,
  /\bux\b/i, /\bui.?design/i, /\bproduct.?manager\b/i, /\bproject.?manager\b/i,
  /\bscrum.?master\b/i, /\bbusiness.?analyst\b/i, /\bconsulting\b/i,
  /\bcustomer.?support\b/i, /\bcustomer.?success\b/i, /\bsocial.?media\b/i,
  /\brecruiter\b/i, /\btalent.?acquisition\b/i,
  /\bqa.?engineer\b/i, /\bquality.?assurance\b/i, /\btesting.?engineer\b/i,
  /\bdata.?scientist\b/i, /\bdata.?analyst\b/i, /\bmachine.?learning.?engineer\b/i,
  /\bai.?engineer\b/i, /\bnlp.?engineer\b/i,
  /\bdevops.?engineer\b/i, /\bsite.?reliability\b/i, /\bsre\b/i,
  /\bcloud.?engineer\b/i, /\binfra.?engineer\b/i,
  /\bembedded.?engineer\b/i, /\bfirmware\b/i, /\bvlsi\b/i, /\bchip.?design\b/i,
  /\bmobile.?developer\b/i, /\bios.?developer\b/i, /\bandroid.?developer\b/i,
  /\bflutter\b/i, /\breact.?native\b/i,
];

// Company patterns that are hard-blocked (consulting, IT services, outsourcing)
const COMPANY_BLOCKLIST_PATTERNS = [
  /\binfosys\b/i, /\btcs\b/i, /\bwipro\b/i, /\bhcl\b/i, /\bcognizant\b/i,
  /\baccenture\b/i, /\bcapgemini\b/i, /\btech.?mahindra\b/i, /\bmindtree\b/i,
  /\bmphasis\b/i, /\bhexaware\b/i, /\bniit\b/i, /\bltimindtree\b/i,
];

function isTitleBlocked(title: string): boolean {
  return TITLE_BLOCKLIST_PATTERNS.some((p) => p.test(title));
}

function isCompanyBlocked(company: string, userBlacklist: string[]): boolean {
  const lower = company.toLowerCase();
  if (COMPANY_BLOCKLIST_PATTERNS.some((p) => p.test(company))) return true;
  return userBlacklist.some((b) => lower.includes(b.toLowerCase()));
}

/**
 * Task 16: Score the quality of a job description.
 * Returns 0 (garbage), 0.5 (thin), or 1.0 (good) based on length and content markers.
 */
function descriptionQualityScore(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 200) return 0;
  if (cleaned.length < 500) return 0.5;
  const hasTechTerms = /\b(api|backend|java|python|node|spring|react|database|system|microservice|engineer|develop|software)\b/i.test(cleaned);
  return hasTechTerms ? 1.0 : 0.7;
}

/**
 * Run all enabled scrapers and persist new jobs to DB.
 * Returns count of new unique jobs added.
 */
export async function runAllScrapers(targetScraperName?: string): Promise<{ total: number; newJobs: number; scraperResults: Record<string, string> }> {
  const settings = await prisma.settings.findFirst();
  if (!settings) throw new Error('Settings not initialized');

  const enabledSources = settings.enabledSources as Record<string, boolean>;
  const query: ScraperQuery = {
    roles: settings.targetRoles,
    locations: settings.targetLocations,
    remoteOnly: settings.remoteOnly,
    minSalaryLpa: settings.minSalaryLpa,
  };

  let total = 0;
  let newJobs = 0;
  const scraperResults: Record<string, string> = {};

  for (const [name, scraper] of Object.entries(ALL_SCRAPERS)) {
    if (targetScraperName && name !== targetScraperName) {
      continue;
    }

    if (enabledSources && enabledSources[name] === false) {
      logger.info(`Scraper "${name}" is disabled, skipping`);
      scraperResults[name] = 'DISABLED';
      continue;
    }

    // Check circuit breaker
    const { allowed, state } = await canRun(name);
    if (!allowed) {
      scraperResults[name] = `CIRCUIT_OPEN`;
      continue;
    }

    try {
      logger.info(`▶ Running scraper: ${name} [circuit: ${state}]`);
      const listings = await scraper.scrape(query);
      total += listings.length;

      const saved = await persistListings(
        listings,
        settings.blacklistedCompanies,
        settings.minSalaryLpa
      );
      newJobs += saved;

      await recordSuccess(name);
      scraperResults[name] = `OK: ${listings.length} fetched, ${saved} new`;
      logger.info(`✅ ${name}: ${listings.length} fetched, ${saved} new`);
    } catch (err) {
      const reason = String((err as Error).message || err).slice(0, 200);
      await recordFailure(name, reason);
      scraperResults[name] = `FAILED: ${reason}`;
      logger.error(`Scraper "${name}" failed`, { error: err });
    }
  }

  // Update last scraped timestamp
  await prisma.settings.updateMany({ data: { lastScrapedAt: new Date() } });

  logger.info(`📊 Scrape complete: ${total} fetched, ${newJobs} new jobs`, { scraperResults });
  return { total, newJobs, scraperResults };
}

/**
 * Persist listings to DB, skipping duplicates and filtered jobs.
 */
async function persistListings(
  listings: JobListing[],
  blacklist: string[],
  minSalaryLpa: number
): Promise<number> {
  let count = 0;

  for (const listing of listings) {
    // ── Pre-filter 1: Title blocklist ─────────────────────────────────────
    if (isTitleBlocked(listing.title)) {
      logger.debug(`Pre-filter: blocked title "${listing.title}"`);
      continue;
    }

    // ── Pre-filter 2: Company blocklist (hardcoded + user settings) ───────
    if (isCompanyBlocked(listing.company, blacklist)) {
      logger.debug(`Pre-filter: blocked company "${listing.company}"`);
      continue;
    }

    // ── Pre-filter 3: Confirmed salary below minimum ───────────────────────
    if (listing.salaryMax !== undefined && listing.salaryMax < (minSalaryLpa * 0.8)) {
      logger.debug(`Pre-filter: salary too low (${listing.salaryMax} LPA) for "${listing.title}"`);
      continue;
    }

    // ── Dedup hash (company + normalized title, NO location) ──────────────
    // Normalizes "Senior SDE" and "SDE II" to same hash
    const normalizedTitle = listing.title
      .toLowerCase()
      .replace(/\b(senior|sr|junior|jr|lead|staff|principal|associate)\b/g, '')
      .replace(/\b(i|ii|iii|1|2|3)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const hashInput = `${listing.company.toLowerCase().trim()}|${normalizedTitle}`;
    const dedupeHash = crypto.createHash('sha256').update(hashInput).digest('hex');

    // Determine salary type
    let salaryType: SalaryType = SalaryType.UNKNOWN;
    if (listing.salaryMin !== undefined) salaryType = SalaryType.CONFIRMED;

    try {
      const existing = await prisma.job.findFirst({
        where: {
          OR: [
            { dedupeHash },
            { url: listing.url },
          ],
        },
      });
      if (existing) continue;

      // Inline refinement and scoring
      const refined = await refineAndScoreJob({
        title: listing.title,
        company: listing.company,
        location: listing.location,
        isRemote: listing.isRemote,
        description: listing.description,
        url: listing.url,
        salaryMin: listing.salaryMin,
        salaryMax: listing.salaryMax,
        salaryRaw: listing.salaryRaw,
        source: listing.source,
      });

      if (!refined) {
        logger.debug(`Pre-filter: discarded job "${listing.title}" due to empty or low quality description`);
        continue;
      }

      let status = 'SCORED';
      if (refined.fitScore === 0) {
        status = 'SKIPPED';
      }

      // Generate embedding inline
      let embedding: number[] = [];
      try {
        const jdText = `${refined.cleanTitle} at ${listing.company}\n\n${refined.cleanDescription}`;
        embedding = await generateEmbedding(jdText.slice(0, 8000));
      } catch (embErr) {
        logger.warn(`Failed to generate embedding inline for ${listing.title}`, { error: embErr });
      }

      await prisma.job.create({
        data: {
          title: refined.cleanTitle,
          company: listing.company,
          location: refined.cleanLocation,
          isRemote: refined.isRemote,
          description: refined.cleanDescription,
          url: listing.url,
          applyUrl: listing.applyUrl,
          salaryMin: refined.salaryMin,
          salaryMax: refined.salaryMax,
          salaryRaw: refined.salaryRaw,
          salaryType: refined.salaryType as any,
          source: listing.source,
          atsType: listing.atsType,
          dedupeHash,
          fitScore: refined.fitScore,
          fitAnalysis: refined as any,
          jdStructured: refined.jdStructured as any,
          embedding,
          status: status as any,
          scoredAt: new Date(),
        },
      });
      if (status === 'SCORED') count++;
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'P2002') {
        logger.error('Error persisting job listing', { error: err, title: listing.title });
      }
    }
  }

  return count;
}

export { JobListing, ScraperQuery };
