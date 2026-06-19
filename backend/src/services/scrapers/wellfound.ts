import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'playwright';
import { JobSource, JobListing, ScraperQuery } from './base';
import { logger } from '../../core/logger';
import { config } from '../../core/config';
import { fetchJobDetails } from './detailFetcher';

chromium.use(stealth());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
];

const ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9',
  'en-IN,en;q=0.9,hi;q=0.8',
  'en-GB,en;q=0.9',
];

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Wellfound (AngelList) scraper.
 * Scrapes startup SDE jobs with salary info.
 * URL: https://wellfound.com/jobs?role=software-engineer&locationSlugs=india&remote=true
 */
export class WellfoundScraper extends JobSource {
  readonly name = 'wellfound';

  async scrape(query: ScraperQuery): Promise<JobListing[]> {
    let browser: Browser | null = null;
    try {
      browser = await this.launchBrowser();
      const page = await this.newStealthPage(browser);
      const listings: JobListing[] = [];

      const searchUrls = this.buildUrls(query);

      for (const url of searchUrls) {
        try {
          logger.info(`Wellfound: Scraping ${url}`);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2000);

          // Scroll to load more jobs
          await this.autoScroll(page);

          // Extract job cards
          const jobs = await page.evaluate(() => {
            const cards = document.querySelectorAll('[data-test="StartupResult"], .job-listing, [class*="JobListingCard"]');
            const results: Array<{
              title: string;
              company: string;
              location: string;
              salary: string;
              url: string;
              description: string;
            }> = [];

            cards.forEach((card) => {
              try {
                const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="role"]');
                const companyEl = card.querySelector('[class*="company"], [class*="startup"]');
                const locationEl = card.querySelector('[class*="location"]');
                const salaryEl = card.querySelector('[class*="compensation"], [class*="salary"]');
                const linkEl = card.querySelector('a[href*="/jobs/"], a[href*="/l/"]') as HTMLAnchorElement;
                const descEl = card.querySelector('[class*="description"], p');

                if (titleEl && companyEl && linkEl) {
                  results.push({
                    title: titleEl.textContent?.trim() || '',
                    company: companyEl.textContent?.trim() || '',
                    location: locationEl?.textContent?.trim() || 'India',
                    salary: salaryEl?.textContent?.trim() || '',
                    url: linkEl.href || '',
                    description: descEl?.textContent?.trim() || '',
                  });
                }
              } catch {
                // skip malformed cards
              }
            });

            return results;
          });

          for (const job of jobs) {
            if (!job.title || !job.company || !job.url) continue;
            const { location, isRemote } = this.normalizeLocation(job.location);
            const { min: salaryMin, max: salaryMax } = this.parseSalaryIndia(job.salary);

            const targetUrl = job.url.startsWith('http') ? job.url : `https://wellfound.com${job.url}`;
            let fullDescription = job.description;

            if (!fullDescription || fullDescription.length < 400) {
              try {
                const details = await fetchJobDetails(targetUrl);
                if (details && details.description && details.description.length > fullDescription.length) {
                  fullDescription = details.description;
                }
              } catch (err) {
                logger.debug(`Wellfound: Failed to fetch detail description for ${targetUrl}`);
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

          logger.info(`Wellfound: Extracted ${jobs.length} jobs from ${url}`);
          await page.waitForTimeout(3000); // polite delay
        } catch (pageError) {
          logger.error(`Wellfound: Error on page ${url}`, { error: pageError });
        }
      }

      return listings;
    } catch (error) {
      logger.error('Wellfound scraper error', { error });
      return [];
    } finally {
      await browser?.close();
    }
  }

  private buildUrls(query: ScraperQuery): string[] {
    const roleMap: Record<string, string> = {
      'Software Development Engineer': 'software-engineer',
      'Backend Engineer': 'backend-engineer',
      'Full Stack Engineer': 'full-stack-engineer',
      'SDE': 'software-engineer',
      'SWE': 'software-engineer',
    };

    const urls: string[] = [];
    for (const role of query.roles.slice(0, 2)) {
      const roleSlug = roleMap[role] || 'software-engineer';
      const base = `https://wellfound.com/jobs?role=${roleSlug}&locationSlugs=india`;
      urls.push(base);
      if (query.remoteOnly) {
        urls.push(`${base}&remote=true`);
      }
    }
    return [...new Set(urls)]; // deduplicate
  }

  private async launchBrowser(): Promise<Browser> {
    return chromium.launch({
      headless: true,
      executablePath: config.CHROMIUM_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-gpu',
      ],
    });
  }

  private async newStealthPage(browser: Browser): Promise<Page> {
    const context = await browser.newContext({
      userAgent: getRandomItem(USER_AGENTS),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      extraHTTPHeaders: {
        'Accept-Language': getRandomItem(ACCEPT_LANGUAGES),
      },
    });

    // Block unnecessary resources (stylesheets, images, fonts, trackers)
    await context.route('**/*', (route) => {
      const url = route.request().url().toLowerCase();
      const resourceType = route.request().resourceType();
      if (
        resourceType === 'image' ||
        resourceType === 'stylesheet' ||
        resourceType === 'font' ||
        resourceType === 'media' ||
        url.includes('google-analytics') ||
        url.includes('analytics') ||
        url.includes('tracking') ||
        url.includes('doubleclick') ||
        url.includes('hotjar')
      ) {
        route.abort();
      } else {
        route.continue();
      }
    });

    return context.newPage();
  }

  private async autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 400;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= 5000) {
            clearInterval(timer);
            resolve();
          }
        }, 300);
      });
    });
    await page.waitForTimeout(1500);
  }
}
