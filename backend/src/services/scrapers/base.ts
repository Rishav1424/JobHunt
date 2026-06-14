/**
 * Abstract base class for all job scrapers.
 * Each platform implements this interface.
 */
export interface JobListing {
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  description: string;
  url: string;
  applyUrl?: string;
  salaryMin?: number;  // in LPA
  salaryMax?: number;  // in LPA
  salaryRaw?: string;  // e.g. "₹20-30 LPA"
  source: string;
  atsType?: string;   // greenhouse | lever | workday | linkedin | direct
}

export interface ScraperQuery {
  roles: string[];
  locations: string[];
  remoteOnly: boolean;
  minSalaryLpa?: number;
}

export abstract class JobSource {
  abstract readonly name: string;

  abstract scrape(query: ScraperQuery): Promise<JobListing[]>;

  /**
   * Parse salary range from raw Indian salary strings.
   * Handles: "₹15-20 LPA", "15-20 LPA", "20L", "₹20,00,000", "20 lakhs", etc.
   */
  protected parseSalaryIndia(raw: string): { min?: number; max?: number } {
    if (!raw) return {};
    const normalized = raw.toLowerCase().replace(/[₹,\s]/g, '');

    // Pattern: 15-20lpa or 15-20l
    const rangeMatch = normalized.match(/(\d+\.?\d*)-(\d+\.?\d*)(?:lpa|l|lakhs?)?/);
    if (rangeMatch) {
      return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
    }

    // Pattern: single value like 20lpa
    const singleMatch = normalized.match(/(\d+\.?\d*)(?:lpa|l|lakhs?)/);
    if (singleMatch) {
      const val = parseFloat(singleMatch[1]);
      return { min: val, max: val };
    }

    // Pattern: annual in rupees e.g. 2000000
    const annualMatch = normalized.match(/^(\d+)$/);
    if (annualMatch) {
      const inr = parseInt(annualMatch[1]);
      if (inr > 100000) {
        const lpa = inr / 100000;
        return { min: lpa, max: lpa };
      }
    }

    return {};
  }

  /**
   * Normalize location string.
   */
  protected normalizeLocation(loc: string): { location: string; isRemote: boolean } {
    const lower = loc.toLowerCase();
    const isRemote =
      lower.includes('remote') ||
      lower.includes('work from home') ||
      lower.includes('wfh') ||
      lower.includes('anywhere');

    return { location: loc.trim() || 'India', isRemote };
  }

  /**
   * Detect ATS type from apply URL.
   */
  protected detectATS(url: string): string {
    if (!url) return 'direct';
    if (url.includes('greenhouse.io')) return 'greenhouse';
    if (url.includes('lever.co')) return 'lever';
    if (url.includes('workday.com')) return 'workday';
    if (url.includes('linkedin.com')) return 'linkedin';
    if (url.includes('smartrecruiters.com')) return 'smartrecruiters';
    if (url.includes('jobvite.com')) return 'jobvite';
    if (url.includes('ashbyhq.com')) return 'ashby';
    return 'direct';
  }
}
