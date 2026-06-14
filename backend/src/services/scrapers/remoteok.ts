import axios from 'axios';
import * as cheerio from 'cheerio';
import { JobSource, JobListing, ScraperQuery } from './base';
import { logger } from '../../core/logger';

interface RemoteOKJob {
  id: string;
  position: string;
  company: string;
  location: string;
  tags: string[];
  description: string;
  url: string;
  apply_url?: string;
  salary_min?: number;
  salary_max?: number;
  date: string;
}

export class RemoteOKScraper extends JobSource {
  readonly name = 'remoteok';

  // SDE-related tags to filter for
  private readonly TARGET_TAGS = [
    'backend', 'full stack', 'fullstack', 'node', 'nodejs', 'java',
    'spring', 'react', 'typescript', 'javascript', 'python', 'distributed',
    'api', 'microservices', 'devops', 'cloud', 'software engineer', 'sde',
  ];

  async scrape(_query: ScraperQuery): Promise<JobListing[]> {
    try {
      const response = await axios.get<RemoteOKJob[]>('https://remoteok.com/api', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
        },
        timeout: 20000,
      });

      // First item is metadata, skip it
      const jobs = response.data.slice(1);

      const listings: JobListing[] = jobs
        .filter((job) => this.isRelevant(job))
        .slice(0, 30)
        .map((job) => {
          // RemoteOK salaries are in USD/year — convert to LPA (approx 1 USD ≈ 83 INR)
          const usdMin = job.salary_min;
          const usdMax = job.salary_max;
          const lpaMin = usdMin ? (usdMin * 83) / 100000 : undefined;
          const lpaMax = usdMax ? (usdMax * 83) / 100000 : undefined;

          return {
            title: job.position,
            company: job.company,
            location: 'Remote',
            isRemote: true,
            description: this.stripHtml(job.description),
            url: `https://remoteok.com/remote-jobs/${job.id}`,
            applyUrl: job.apply_url || `https://remoteok.com/remote-jobs/${job.id}`,
            salaryMin: lpaMin,
            salaryMax: lpaMax,
            salaryRaw: usdMin ? `$${usdMin}–$${usdMax}/yr (Remote)` : undefined,
            source: this.name,
            atsType: this.detectATS(job.apply_url || ''),
          };
        });

      logger.info(`RemoteOK: Found ${listings.length} relevant remote SDE jobs`);
      return listings;
    } catch (error) {
      logger.error('RemoteOK scrape error', { error });
      return [];
    }
  }

  private isRelevant(job: RemoteOKJob): boolean {
    const combined = [
      job.position,
      ...(job.tags || []),
    ].join(' ').toLowerCase();
    
    return this.TARGET_TAGS.some((tag) => combined.includes(tag));
  }

  private stripHtml(html: string): string {
    if (!html) return '';
    const $ = cheerio.load(html);
    return $.text().trim();
  }
}
