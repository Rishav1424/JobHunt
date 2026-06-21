import { BrowserContext, Page } from 'playwright';
import { JobSource, JobListing, ScraperQuery } from './base';
import { logger } from '../../core/logger';
import { config } from '../../core/config';
import { browserPool } from './browserPool';
import { fetchJobDetails } from './detailFetcher';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function findJobsInState(obj: any): any[] | null {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    const hasJob = obj.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item.title || item.jobTitle) &&
        (item.companyName || item.company || item.companyLabel)
    );
    if (hasJob) return obj;
    for (const child of obj) {
      const found = findJobsInState(child);
      if (found) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      const found = findJobsInState(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

export class NaukriScraper extends JobSource {
  readonly name = 'naukri';

  async scrape(query: ScraperQuery): Promise<JobListing[]> {
    let context: BrowserContext | null = null;
    try {
      context = await browserPool.newContext({
        userAgent: getRandomItem(USER_AGENTS),
        viewport: { width: 1440, height: 900 },
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
      });

      await context.route('**/*', (route) => {
        const url = route.request().url().toLowerCase();
        const resourceType = route.request().resourceType();
        if (resourceType === 'document') {
          route.continue();
          return;
        }
        if (
          resourceType === 'image' ||
          resourceType === 'font' ||
          resourceType === 'media' ||
          url.includes('google-analytics') ||
          url.includes('analytics') ||
          (url.includes('tracking') && resourceType === 'script') ||
          url.includes('doubleclick') ||
          url.includes('hotjar')
        ) {
          route.abort();
        } else {
          route.continue();
        }
      });

      const page = await context.newPage();
      const listings: JobListing[] = [];

      // Intercept XHR responses for Naukri's internal job search API
      const interceptedJobs: any[] = [];
      page.on('response', async (res) => {
        try {
          const url = res.url();
          if (url.includes('jobapi/v3/search') || url.includes('jobapi/v4/search') || url.includes('jobapi/')) {
            const json = await res.json();
            const jobArr = findJobsInState(json);
            if (jobArr && jobArr.length > 0) {
              interceptedJobs.push(...jobArr);
            }
          }
        } catch {
          // ignore parsing/network errors
        }
      });

      for (const role of query.roles.slice(0, 2)) {
        try {
          // Slugify the role name
          const roleSlug = role
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

          const url = `https://www.naukri.com/${roleSlug}-jobs-in-india?k=${encodeURIComponent(role)}&l=india`;
          logger.info(`Naukri: Navigating to ${url}`);

          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await page.waitForTimeout(4000);

          // Scroll down to trigger API requests and lazy loading
          await page.evaluate(() => window.scrollBy(0, 800));
          await page.waitForTimeout(2000);

          let parsedJobs: any[] = [];

          // Strategy 1: Use intercepted XHR jobs
          if (interceptedJobs.length > 0) {
            logger.info(`Naukri: Using ${interceptedJobs.length} XHR intercepted jobs`);
            parsedJobs = [...interceptedJobs];
          }

          // Strategy 2: Fall back to window.__INITIAL_STATE__
          if (parsedJobs.length === 0) {
            logger.info('Naukri: Fallback to __INITIAL_STATE__');
            const state = await page.evaluate(() => (window as any).__INITIAL_STATE__);
            if (state) {
              const jobArr = findJobsInState(state);
              if (jobArr && jobArr.length > 0) {
                logger.info(`Naukri: Found ${jobArr.length} jobs in initial state`);
                parsedJobs = jobArr;
              }
            }
          }

          // Strategy 3: Fall back to DOM parsing
          if (parsedJobs.length === 0) {
            logger.info('Naukri: Fallback to DOM parsing');
            const domJobs = await page.evaluate(() => {
              const cards = document.querySelectorAll('.cust-job-tuple, .srp-job-tuple, [class*="jobTuple"], [data-job-id]');
              return Array.from(cards).map((card) => {
                const titleEl = card.querySelector('a.title, [class*="title"], [class*="role"]');
                const companyEl = card.querySelector('.comp-name, [class*="companyName"], [class*="employer"]');
                const locationEl = card.querySelector('.locWdth, [class*="location"]');
                const salaryEl = card.querySelector('.sal, [class*="salary"]');
                const descEl = card.querySelector('.job-desc, [class*="jobDescription"]');
                return {
                  title: titleEl?.textContent?.trim() || '',
                  companyName: companyEl?.textContent?.trim() || '',
                  placeholders: [
                    { type: 'location', label: locationEl?.textContent?.trim() || 'India' },
                    { type: 'salary', label: salaryEl?.textContent?.trim() || 'Not disclosed' },
                  ],
                  jdURL: (titleEl as HTMLAnchorElement)?.href || '',
                  jobDescription: descEl?.textContent?.trim() || '',
                };
              }).filter((j) => j.title && j.companyName);
            });
            logger.info(`Naukri: Found ${domJobs.length} jobs via DOM parsing`);
            parsedJobs = domJobs;
          }

          // Normalize and yield results
          for (const job of parsedJobs) {
            const title = job.title || job.jobTitle || '';
            const company = job.companyName || job.company || job.companyLabel || '';
            const rawUrl = job.jdURL || job.jdUrl || '';
            const url = rawUrl.startsWith('http') ? rawUrl : rawUrl ? `https://www.naukri.com${rawUrl}` : '';
            if (!title || !company || !url) continue;

            const placeholders = job.placeholders || [];
            const locationStr = placeholders.find((p: any) => p.type === 'location')?.label || 'India';
            const salaryStr = placeholders.find((p: any) => p.type === 'salary')?.label || 'Not disclosed';
            const expStr = placeholders.find((p: any) => p.type === 'experience')?.label || '';

            const { location, isRemote } = this.normalizeLocation(locationStr);
            const { min: salaryMin, max: salaryMax } = this.parseSalaryIndia(salaryStr);

            // Task 15: Fetch detail page for short/missing descriptions
            let description = job.jobDescription || '';
            if (!description || description.length < 400) {
              try {
                const details = await fetchJobDetails(url);
                if (details?.description && details.description.length > description.length) {
                  description = details.description;
                  logger.debug(`Naukri: enriched description for "${title}" via detail fetch`);
                }
              } catch {
                /* use what we have */
              }
            }
            if (!description) {
              description = `${title} at ${company}. Experience: ${expStr}. Salary: ${salaryStr}`;
            }

            listings.push({
              title,
              company,
              location,
              isRemote,
              description,
              url,
              salaryMin,
              salaryMax,
              salaryRaw: salaryStr !== 'Not disclosed' ? salaryStr : undefined,
              source: this.name,
              atsType: this.detectATS(url),
            });
          }

          logger.info(`Naukri: Completed scraping for "${role}", listings count: ${listings.length}`);
        } catch (roleErr) {
          logger.error(`Naukri error for role "${role}"`, { error: roleErr });
        }
      }

      return listings;
    } catch (error) {
      logger.error('Naukri scraper error', { error });
      return [];
    } finally {
      await context?.close();
    }
  }
}
