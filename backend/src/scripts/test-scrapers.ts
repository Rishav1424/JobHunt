import { NaukriScraper } from '../services/scrapers/naukri';
import { ATSScraper } from '../services/scrapers/ats';
import { YCombinatorScraper } from '../services/scrapers/ycombinator';
import { logger } from '../core/logger';

async function testNewScrapers() {
  logger.info('🚀 Testing New Scrapers...');

  const query = {
    roles: ['Backend Engineer'],
    locations: ['India'],
    remoteOnly: false,
    minSalaryLpa: 15,
  };

  // 1. Test Naukri Scraper
  try {
    logger.info('--- 1. Testing Naukri Scraper ---');
    const naukri = new NaukriScraper();
    const results = await naukri.scrape(query);
    logger.info(`Naukri results: ${results.length} found`);
    results.slice(0, 3).forEach((r, idx) => {
      logger.info(`[${idx + 1}] ${r.title} @ ${r.company} (${r.location}) - URL: ${r.url}`);
    });
  } catch (err) {
    logger.error('Naukri Scraper test failed', { error: err });
  }

  // 2. Test ATS Scraper (Greenhouse / Lever / Ashby via Serper)
  try {
    logger.info('--- 2. Testing ATS Scraper ---');
    const ats = new ATSScraper();
    const results = await ats.scrape(query);
    logger.info(`ATS results: ${results.length} found`);
    results.slice(0, 3).forEach((r, idx) => {
      logger.info(`[${idx + 1}] ${r.title} @ ${r.company} (${r.location}) - URL: ${r.url}`);
    });
  } catch (err) {
    logger.error('ATS Scraper test failed', { error: err });
  }

  // 3. Test Y Combinator Scraper
  try {
    logger.info('--- 3. Testing Y Combinator Scraper ---');
    const yc = new YCombinatorScraper();
    const results = await yc.scrape(query);
    logger.info(`YC results: ${results.length} found`);
    results.slice(0, 3).forEach((r, idx) => {
      logger.info(`[${idx + 1}] ${r.title} @ ${r.company} (${r.location}) - URL: ${r.url}`);
    });
  } catch (err) {
    logger.error('YC Scraper test failed', { error: err });
  }

  logger.info('🎉 Scraper tests finished.');
}

testNewScrapers().catch((err) => {
  logger.error('Scraper test execution failed', { error: err });
});
