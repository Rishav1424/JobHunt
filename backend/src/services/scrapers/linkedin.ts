import { chromium, Browser, Page } from 'playwright';
import { JobSource, JobListing, ScraperQuery } from './base';
import { logger } from '../../core/logger';
import { config } from '../../core/config';

const DETAIL_TIMEOUT_MS = 12000;
const MAX_JOBS_PER_ROLE = 15;

/**
 * LinkedIn Jobs scraper — read-only, no login required.
 * Scrapes public job search results, then fetches full descriptions from each job page.
 */
export class LinkedInScraper extends JobSource {
  readonly name = 'linkedin';

  async scrape(query: ScraperQuery): Promise<JobListing[]> {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        executablePath: config.CHROMIUM_PATH,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-extensions',
          '--disable-gpu',
        ],
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1440, height: 900 },
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        extraHTTPHeaders: { 'Accept-Language': 'en-IN,en;q=0.9' },
      });

      // Block heavy resources to speed up scraping
      await context.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,mp4,webm}', (r) => r.abort());
      await context.route('**/li/track*', (r) => r.abort());

      const listPage = await context.newPage();
      const listings: JobListing[] = [];

      // Only scrape top 2 roles — LinkedIn is slow, quality > quantity
      for (const role of query.roles.slice(0, 2)) {
        try {
          const location = query.remoteOnly ? 'remote' : 'India';
          const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}&f_E=1,2&f_JT=F,I&sortBy=DD&f_TPR=r86400`;
          // f_E=1,2 → entry level + associate; f_TPR=r86400 → last 24 hours

          logger.info(`LinkedIn: Scraping "${role}"`);
          await listPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await listPage.waitForTimeout(3000);

          // Scroll to load more results
          for (let i = 0; i < 3; i++) {
            await listPage.keyboard.press('End');
            await listPage.waitForTimeout(1200);
          }

          const seeMoreBtn = listPage.locator('button:has-text("See more jobs")').first();
          if (await seeMoreBtn.isVisible().catch(() => false)) {
            await seeMoreBtn.click();
            await listPage.waitForTimeout(2000);
          }

          // Extract job cards from list page
          const cards = await listPage.evaluate(() => {
            const items = document.querySelectorAll(
              '.jobs-search__results-list li, .base-card'
            );
            const results: Array<{
              title: string; company: string; location: string;
              url: string; easyApply: boolean;
            }> = [];

            items.forEach((card) => {
              try {
                const titleEl = card.querySelector('.base-search-card__title, h3.base-search-card__title');
                const companyEl = card.querySelector('.base-search-card__subtitle, h4.base-search-card__subtitle');
                const locationEl = card.querySelector('.job-search-card__location, .base-search-card__metadata');
                const linkEl = card.querySelector('a.base-card__full-link, a[data-tracking-control-name]') as HTMLAnchorElement;
                const easyApply = !!card.querySelector('[aria-label="Easy Apply"]');

                if (titleEl && companyEl && linkEl?.href) {
                  results.push({
                    title: titleEl.textContent?.trim() || '',
                    company: companyEl.textContent?.trim() || '',
                    location: locationEl?.textContent?.trim() || 'India',
                    url: linkEl.href,
                    easyApply,
                  });
                }
              } catch { /* skip */ }
            });
            return results;
          });

          logger.info(`LinkedIn: Found ${cards.length} cards for "${role}", fetching descriptions...`);

          // Fetch full description for each job (up to MAX_JOBS_PER_ROLE)
          for (const card of cards.slice(0, MAX_JOBS_PER_ROLE)) {
            if (!card.title || !card.company || !card.url) continue;

            const description = await this.fetchJobDescription(context, card.url);
            const { location: loc, isRemote } = this.normalizeLocation(card.location);

            listings.push({
              title: card.title,
              company: card.company,
              location: loc,
              isRemote,
              description,
              url: card.url,
              applyUrl: card.easyApply ? card.url : undefined,
              source: this.name,
              atsType: card.easyApply ? 'linkedin' : this.detectATS(card.url),
            });

            // Small delay between detail pages
            await new Promise((r) => setTimeout(r, 800));
          }

          logger.info(`LinkedIn: Scraped ${Math.min(cards.length, MAX_JOBS_PER_ROLE)} jobs with descriptions for "${role}"`);
          await listPage.waitForTimeout(4000);
        } catch (err) {
          logger.error(`LinkedIn error for role "${role}"`, { error: err });
        }
      }

      return listings;
    } catch (error) {
      logger.error('LinkedIn scraper error', { error });
      return [];
    } finally {
      await browser?.close();
    }
  }

  /**
   * Open a job detail page and extract the full description.
   * Falls back to a meaningful placeholder if it fails.
   */
  private async fetchJobDescription(
    context: import('playwright').BrowserContext,
    url: string
  ): Promise<string> {
    const page: Page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DETAIL_TIMEOUT_MS });
      await page.waitForTimeout(1500);

      const description = await page.evaluate(() => {
        // Try multiple selector patterns LinkedIn uses
        const selectors = [
          '.show-more-less-html__markup',
          '.description__text',
          '[class*="jobs-description"]',
          '.jobs-description-content__text',
          'section.description',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        // Fall back to any large text block
        const divs = Array.from(document.querySelectorAll('div'));
        const large = divs.find((d) => (d.textContent?.length || 0) > 500 && !d.querySelector('nav'));
        return large?.textContent?.trim() || '';
      });

      return description.slice(0, 8000) || `${url} — description unavailable`;
    } catch (err) {
      logger.warn(`LinkedIn: Failed to fetch description for ${url}`, { error: (err as Error).message });
      return `${url} — description fetch timed out`;
    } finally {
      await page.close();
    }
  }
}
