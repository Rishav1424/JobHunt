import { BrowserContext, Page } from 'playwright';
import { JobSource, JobListing, ScraperQuery } from './base';
import { logger } from '../../core/logger';
import { config } from '../../core/config';
import { browserPool } from './browserPool';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export class YCombinatorScraper extends JobSource {
  readonly name = 'ycombinator';

  async scrape(query: ScraperQuery): Promise<JobListing[]> {
    let context: BrowserContext | null = null;
    try {
      context = await browserPool.newContext({
        userAgent: getRandomItem(USER_AGENTS),
        viewport: { width: 1440, height: 900 },
        locale: 'en-US',
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
          (url.includes('tracking') && resourceType === 'script')
        ) {
          route.abort();
        } else {
          route.continue();
        }
      });

      const page = await context.newPage();
      const listings: JobListing[] = [];

      // Intercept response from Algolia search API
      const interceptedJobs: any[] = [];
      page.on('response', async (res) => {
        try {
          const url = res.url();
          if (url.includes('.algolia.net') && res.request().method() === 'POST') {
            const json = await res.json();
            if (json && json.results) {
              for (const searchResult of json.results) {
                if (searchResult.hits && searchResult.hits.length > 0) {
                  interceptedJobs.push(...searchResult.hits);
                }
              }
            }
          }
        } catch {
          // skip
        }
      });

      for (const role of query.roles.slice(0, 2)) {
        try {
          const url = `https://www.workatastartup.com/jobs?query=${encodeURIComponent(role)}`;
          logger.info(`YCombinator: Navigating to ${url}`);

          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await page.waitForTimeout(5000);

          // Scroll a bit to trigger queries
          await page.evaluate(() => window.scrollBy(0, 500));
          await page.waitForTimeout(2000);

          let parsedJobs: any[] = [];

          // Strategy 1: Use intercepted Algolia hits
          if (interceptedJobs.length > 0) {
            logger.info(`YCombinator: Using ${interceptedJobs.length} Algolia intercepted jobs`);
            parsedJobs = [...interceptedJobs];
          }

          // Strategy 2: Fall back to DOM parsing
          if (parsedJobs.length === 0) {
            logger.info('YCombinator: Fallback to DOM parsing');
            const domJobs = await page.evaluate(() => {
              const divs = Array.from(document.querySelectorAll('div'));
              const cards = divs.filter(
                (el) => el.className.includes('cursor-pointer') && el.className.includes('flex-col')
              );

              return cards.map((card) => {
                const applyLink = card.querySelector('a') as HTMLAnchorElement | null;
                const url = applyLink?.href || '';
                
                const textContent = card.innerText || '';
                const lines = textContent.split('\n').map((l) => l.trim()).filter(Boolean);
                
                // Lines: 0 = Company name & description, 1 = Job title, 2+ = Details
                const companyRaw = lines[0] || '';
                const company = companyRaw.split('•')[0]?.trim() || '';
                const title = lines[1] || '';
                const description = lines.slice(2).join('\n') || '';

                return {
                  title,
                  company,
                  location: 'Remote',
                  salary: '',
                  description,
                  url,
                };
              }).filter((j) => j.title && j.company && j.url);
            });
            logger.info(`YCombinator: Found ${domJobs.length} jobs via DOM parsing`);
            parsedJobs = domJobs;
          }

          // Normalization & extraction
          for (const job of parsedJobs) {
            // Algolia hits usually have nested structure, fallback to flat
            const title = job.title || job.position || '';
            const company = job.company?.name || job.company_name || job.company || '';
            const jobId = job.id || job.job_id || '';
            const jobUrl = job.url || (jobId ? `https://www.workatastartup.com/jobs/${jobId}` : '');
            if (!title || !company || !jobUrl) continue;

            const description = job.description || job.job_description || job.snippet || `${title} at ${company}`;
            const locationStr = job.location || job.job_location || 'Remote';
            
            // Salary handling
            let salaryMin: number | undefined;
            let salaryMax: number | undefined;
            let salaryRaw: string | undefined;

            if (job.salary_min !== undefined) {
              // Convert USD/year to LPA (approx 1 USD ≈ 83 INR)
              salaryMin = (job.salary_min * 83) / 100000;
            }
            if (job.salary_max !== undefined) {
              salaryMax = (job.salary_max * 83) / 100000;
            }
            if (salaryMin !== undefined) {
              salaryRaw = `$${Math.round(job.salary_min / 1000)}k - $${Math.round((job.salary_max || 0) / 1000)}k`;
            }

            const { location, isRemote } = this.normalizeLocation(locationStr);

            listings.push({
              title,
              company,
              location,
              isRemote,
              description,
              url: jobUrl,
              salaryMin,
              salaryMax,
              salaryRaw,
              source: this.name,
              atsType: this.detectATS(jobUrl),
            });
          }

          logger.info(`YCombinator: Completed scraping for "${role}", listings count: ${listings.length}`);
        } catch (roleErr) {
          logger.error(`YCombinator error for role "${role}"`, { error: roleErr });
        }
      }

      return listings;
    } catch (error) {
      logger.error('YCombinator scraper error', { error });
      return [];
    } finally {
      await context?.close();
    }
  }
}
