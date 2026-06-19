import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../../core/logger';

export interface DetailResult {
  title?: string;
  company?: string;
  location?: string;
  description: string;
}

/**
 * Shared utility to fetch detailed job postings from ATS platforms or direct company links.
 * 
 * Supports:
 * 1. Greenhouse Jobs Board API
 * 2. Lever Postings API
 * 3. Fallback Raw HTML parsing with custom selectors
 */
export async function fetchJobDetails(url: string): Promise<DetailResult | null> {
  if (!url) return null;
  const lowercaseUrl = url.toLowerCase().trim();

  // ── 1. Greenhouse Board API ────────────────────────────────────────────────
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
        logger.debug(`detailFetcher: Greenhouse API failed for ${url}, falling back to HTML fetch`);
      }
    }
  }

  // ── 2. Lever Postings API ──────────────────────────────────────────────────
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
        logger.debug(`detailFetcher: Lever API failed for ${url}, falling back to HTML fetch`);
      }
    }
  }

  // ── 3. Fallback: Raw HTML Fetch ────────────────────────────────────────────
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(res.data);
    const title = $('h1, h2, title').first().text().trim();
    
    // Attempt to parse description using common class/ID patterns
    const selectors = [
      '[class*="description"]',
      '[class*="job-description"]',
      '[class*="postings-wrapper"]',
      '[class*="jobDescription"]',
      '[class*="opportunity-detail"]',
      '[id*="description"]',
      'main',
      'article',
      'body'
    ];

    let description = '';
    for (const selector of selectors) {
      const text = $(selector).first().text().replace(/\s+/g, ' ').trim();
      if (text.length > 300) {
        description = text;
        break;
      }
    }

    if (!description) {
      description = $('body').text().replace(/\s+/g, ' ').trim();
    }

    return {
      title,
      description,
    };
  } catch (err) {
    logger.warn(`detailFetcher: HTML fetch failed for ${url}`, { error: (err as Error).message });
    return null;
  }
}
