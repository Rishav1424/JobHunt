import axios from 'axios';
import { JobSource, JobListing, ScraperQuery } from './base';
import { config } from '../../core/config';
import { logger } from '../../core/logger';
import { fetchJobDetails } from './detailFetcher';

interface AdzunaJob {
  id: string;
  title: string;
  company: { display_name: string };
  location: { display_name: string };
  salary_min?: number;
  salary_max?: number;
  description: string;
  redirect_url: string;
  contract_type?: string;
  created: string;
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

export class AdzunaScraper extends JobSource {
  readonly name = 'adzuna';

  private readonly BASE_URL = 'https://api.adzuna.com/v1/api/jobs/in/search';

  async scrape(query: ScraperQuery): Promise<JobListing[]> {
    if (!config.ADZUNA_APP_ID || !config.ADZUNA_API_KEY) {
      logger.warn('Adzuna API credentials not configured, skipping');
      return [];
    }

    const listings: JobListing[] = [];

    for (const role of query.roles.slice(0, 3)) { // limit API calls
      try {
        const params = {
          app_id: config.ADZUNA_APP_ID,
          app_key: config.ADZUNA_API_KEY,
          results_per_page: 20,
          what: role,
          where: query.remoteOnly ? 'remote' : (query.locations[0] || 'India'),
          // Filter: salary in rupees (15 LPA = 1,500,000)
          salary_min: query.minSalaryLpa ? query.minSalaryLpa * 100000 : 1500000,
        };

        const response = await axios.get<AdzunaResponse>(
          `${this.BASE_URL}/1`,
          { params, timeout: 15000 }
        );

        for (const job of response.data.results) {
          const { location, isRemote } = this.normalizeLocation(job.location.display_name);
          
          // Convert from INR to LPA
          const salaryMin = job.salary_min ? job.salary_min / 100000 : undefined;
          const salaryMax = job.salary_max ? job.salary_max / 100000 : undefined;

          let fullDescription = job.description;
          if (!fullDescription || fullDescription.length < 400) {
            try {
              const details = await fetchJobDetails(job.redirect_url);
              if (details && details.description && details.description.length > fullDescription.length) {
                fullDescription = details.description;
              }
            } catch (err) {
              logger.debug(`Adzuna: Failed to fetch detail description for ${job.redirect_url}`);
            }
          }

          listings.push({
            title: job.title,
            company: job.company.display_name,
            location,
            isRemote,
            description: fullDescription || job.description,
            url: job.redirect_url,
            applyUrl: job.redirect_url,
            salaryMin,
            salaryMax,
            salaryRaw: salaryMin ? `₹${salaryMin}–${salaryMax} LPA` : undefined,
            source: this.name,
            atsType: this.detectATS(job.redirect_url),
          });
        }

        logger.info(`Adzuna: Found ${response.data.results.length} jobs for "${role}"`);
        
        // Rate limit: Adzuna allows 200 req/day, be conservative
        await this.delay(500);
      } catch (error) {
        logger.error(`Adzuna scrape error for role "${role}"`, { error });
      }
    }

    return listings;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
