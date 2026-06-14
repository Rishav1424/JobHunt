import axios from 'axios';
import * as cheerio from 'cheerio';
import { JobSource, JobListing, ScraperQuery } from './base';
import { logger } from '../../core/logger';
import { config } from '../../core/config';

export class ATSScraper extends JobSource {
  readonly name = 'ats';

  async scrape(query: ScraperQuery): Promise<JobListing[]> {
    if (!config.SERPER_API_KEY) {
      logger.warn('ATSScraper: SERPER_API_KEY not configured, skipping Google search');
      return [];
    }

    const listings: JobListing[] = [];

    // Query Serper separately for each of the top 2 roles to ensure high-signal queries
    for (const role of query.roles.slice(0, 2)) {
      try {
        const q = `site:lever.co OR site:boards.greenhouse.io "${role}" India`;
        logger.info(`ATSScraper: Querying Google Serper for role "${role}" with: ${q}`);

        const response = await axios.post(
          'https://google.serper.dev/search',
          { q, num: 10, gl: 'in', hl: 'en' },
          {
            headers: {
              'X-API-KEY': config.SERPER_API_KEY,
              'Content-Type': 'application/json',
            },
            timeout: 20000,
          }
        );

        const organic = response.data.organic || [];
        logger.info(`ATSScraper: Google Search returned ${organic.length} results for "${role}"`);

        for (const result of organic) {
          const url = result.link;
          if (!url) continue;

          // Clean URLs: Skip directories/indexes, process only individual postings
          const lowercaseUrl = url.toLowerCase();
          const isJobPosting =
            (lowercaseUrl.includes('lever.co') && url.split('/').length >= 5) ||
            (lowercaseUrl.includes('greenhouse.io') && lowercaseUrl.includes('/jobs/'));

          if (!isJobPosting) {
            logger.debug(`ATSScraper: Skipping index/directory URL: ${url}`);
            continue;
          }

          try {
            logger.info(`ATSScraper: Fetching detail for: ${url}`);
            const detail = await this.fetchATSDetail(url);
            if (!detail || !detail.description) continue;

            const title = detail.title || this.cleanTitle(result.title);
            const company = detail.company || this.inferCompany(url, result.title);
            const locationStr = detail.location || this.inferLocation(result.title, result.snippet);

            const { location, isRemote } = this.normalizeLocation(locationStr);

            listings.push({
              title,
              company,
              location,
              isRemote,
              description: detail.description,
              url,
              source: this.name,
              atsType: this.detectATS(url),
            });

            // Small sleep to prevent rate-limiting when querying detail APIs
            await new Promise((r) => setTimeout(r, 600));
          } catch (err) {
            logger.warn(`ATSScraper: Failed to fetch detail for ${url}`, { error: err });
          }
        }
      } catch (error) {
        logger.error(`ATSScraper error for role "${role}"`, { error });
      }
    }

    logger.info(`ATSScraper: Completed with ${listings.length} jobs scraped`);
    return listings;
  }

  private cleanTitle(title: string): string {
    if (!title) return '';
    return title
      .split(' - ')
      .filter((part) => !part.toLowerCase().includes('greenhouse') && !part.toLowerCase().includes('lever'))
      .join(' - ')
      .trim();
  }

  private inferCompany(url: string, searchTitle: string): string {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/');
      if (u.hostname.includes('greenhouse.io')) {
        return parts[1] || 'Greenhouse Company';
      }
      if (u.hostname.includes('lever.co')) {
        return parts[1] || 'Lever Company';
      }
    } catch {
      // skip
    }

    const parts = searchTitle.split(' - ');
    if (parts.length > 1) {
      return parts[parts.length - 2].trim();
    }
    return 'Unknown Company';
  }

  private inferLocation(title: string, snippet: string): string {
    const combined = `${title} ${snippet}`.toLowerCase();
    if (combined.includes('remote') || combined.includes('work from home')) return 'Remote';
    if (combined.includes('bangalore') || combined.includes('bengaluru')) return 'Bangalore';
    if (combined.includes('mumbai')) return 'Mumbai';
    if (combined.includes('hyderabad')) return 'Hyderabad';
    if (combined.includes('noida')) return 'Noida';
    if (combined.includes('pune')) return 'Pune';
    if (combined.includes('gurgaon') || combined.includes('gurugram')) return 'Gurgaon';
    return 'India';
  }

  private async fetchATSDetail(
    url: string
  ): Promise<{ description: string; title?: string; company?: string; location?: string } | null> {
    const lowercaseUrl = url.toLowerCase();

    // 1. Greenhouse Board API
    if (lowercaseUrl.includes('greenhouse.io')) {
      const match = url.match(/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/i);
      if (match) {
        const company = match[1];
        const jobId = match[2];
        try {
          const res = await axios.get(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}`, { timeout: 10000 });
          if (res.data) {
            const $ = cheerio.load(res.data.content || '');
            const description = $.text().trim();
            return {
              title: res.data.title,
              description,
              location: res.data.location?.name,
              company: company.charAt(0).toUpperCase() + company.slice(1),
            };
          }
        } catch (err) {
          logger.debug(`ATSScraper: Greenhouse API failed for ${url}, fallback to HTML`);
        }
      }
    }

    // 2. Lever Postings API
    if (lowercaseUrl.includes('lever.co')) {
      const match = url.match(/jobs\.lever\.co\/([^/]+)\/([^/]+)/i);
      if (match) {
        const company = match[1];
        const jobId = match[2];
        try {
          const res = await axios.get(`https://api.lever.co/v0/postings/${company}/${jobId}`, { timeout: 10000 });
          if (res.data) {
            const descriptionHtml = [
              res.data.descriptionHtml || '',
              ...(res.data.lists || []).map((l: any) => `<h3>${l.text}</h3>\n<ul>\n${(l.content || []).map((item: string) => `<li>${item}</li>`).join('\n')}\n</ul>`),
              res.data.additionalHtml || '',
            ].join('\n\n');
            const $ = cheerio.load(descriptionHtml);
            const description = $.text().trim();
            return {
              title: res.data.title,
              description,
              location: res.data.categories?.location,
              company: company.charAt(0).toUpperCase() + company.slice(1),
            };
          }
        } catch (err) {
          logger.debug(`ATSScraper: Lever API failed for ${url}, fallback to HTML`);
        }
      }
    }

    // 3. Fallback: Raw HTML Fetch
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        timeout: 10000,
      });

      const $ = cheerio.load(res.data);
      const title = $('h1, h2, title').first().text().trim();
      let description = $('[class*="description"], [class*="job-description"], [class*="postings-wrapper"], [id*="description"]').text().trim();
      if (!description) {
        description = $('main, article, body').first().text().replace(/\s+/g, ' ').trim();
      }

      return {
        title,
        description,
      };
    } catch (err) {
      logger.warn(`ATSScraper: HTML fallback fetch failed for ${url}`);
      return null;
    }
  }
}
