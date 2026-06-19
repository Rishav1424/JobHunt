import { chromium, Browser, Page } from 'playwright';
import { JobSource, JobListing, ScraperQuery } from './base';
import { logger } from '../../core/logger';
import { config } from '../../core/config';
import { fetchJobDetails } from './detailFetcher';

/**
 * InstaHyre scraper — India-first platform with CTC filters.
 * URL: https://www.instahyre.com/search-jobs/?designation=software+engineer&location=&min_salary=1500000
 */
export class InstaHyreScraper extends JobSource {
  readonly name = 'instahyre';

  async scrape(query: ScraperQuery): Promise<JobListing[]> {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: config.CHROMIUM_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'en-IN',
      });

      await context.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2}', (route) => route.abort());
      const page = await context.newPage();

      const listings: JobListing[] = [];
      const minSalaryInr = (query.minSalaryLpa || 15) * 100000;

      for (const role of query.roles.slice(0, 2)) {
        try {
          const url = `https://www.instahyre.com/search-jobs/?designation=${encodeURIComponent(role)}&min_salary=${minSalaryInr}`;
          
          logger.info(`InstaHyre: Scraping ${url}`);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(3000);

          // Wait for job cards to load
          await page.waitForSelector('.opportunity-card, .job-card, [class*="OpportunityCard"]', {
            timeout: 10000,
          }).catch(() => null);

          const jobs = await page.evaluate(() => {
            const selectors = [
              '.opportunity-card',
              '.job-card',
              '[class*="OpportunityCard"]',
              '[class*="job-item"]',
            ];

            let cards: Element[] = [];
            for (const sel of selectors) {
              const found = Array.from(document.querySelectorAll(sel));
              if (found.length > 0) { cards = found; break; }
            }

            return cards.map((card) => {
              const title = card.querySelector('h2, h3, .title, [class*="role"], [class*="designation"]')?.textContent?.trim() || '';
              const company = card.querySelector('.company, [class*="company"], [class*="employer"]')?.textContent?.trim() || '';
              const location = card.querySelector('.location, [class*="location"]')?.textContent?.trim() || 'India';
              const salary = card.querySelector('.salary, [class*="salary"], [class*="ctc"]')?.textContent?.trim() || '';
              const link = card.querySelector('a') as HTMLAnchorElement | null;
              const description = card.querySelector('.description, p, [class*="desc"]')?.textContent?.trim() || '';

              return {
                title,
                company,
                location,
                salary,
                url: link?.href || '',
                description,
              };
            }).filter((j) => j.title && j.company);
          });

          for (const job of jobs) {
            const { location, isRemote } = this.normalizeLocation(job.location);
            const { min: salaryMin, max: salaryMax } = this.parseSalaryIndia(job.salary);

            const targetUrl = job.url.startsWith('http') ? job.url : `https://www.instahyre.com${job.url}`;
            let fullDescription = job.description;

            if (!fullDescription || fullDescription.length < 400) {
              try {
                const details = await fetchJobDetails(targetUrl);
                if (details && details.description && details.description.length > fullDescription.length) {
                  fullDescription = details.description;
                }
              } catch (err) {
                logger.debug(`InstaHyre: Failed to fetch detail description for ${targetUrl}`);
              }
            }

            listings.push({
              title: job.title,
              company: job.company,
              location,
              isRemote,
              description: fullDescription || `${job.title} at ${job.company}`,
              url: targetUrl,
              salaryMin,
              salaryMax,
              salaryRaw: job.salary || undefined,
              source: this.name,
              atsType: this.detectATS(targetUrl),
            });
          }

          logger.info(`InstaHyre: Found ${jobs.length} jobs for "${role}"`);
          await page.waitForTimeout(2000);
        } catch (err) {
          logger.error(`InstaHyre error for role "${role}"`, { error: err });
        }
      }

      return listings;
    } catch (error) {
      logger.error('InstaHyre scraper error', { error });
      return [];
    } finally {
      await browser?.close();
    }
  }
}
