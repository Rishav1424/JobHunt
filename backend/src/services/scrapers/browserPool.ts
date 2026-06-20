import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { Browser, BrowserContext } from 'playwright';
import { config } from '../../core/config';
import { logger } from '../../core/logger';

chromium.use(stealth());

class PlaywrightBrowserPool {
  private browser: Browser | null = null;

  async acquire(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      logger.info('🚀 Launching shared browser pool instance...');
      this.browser = await chromium.launch({
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
    return this.browser;
  }

  async newContext(options: any = {}): Promise<BrowserContext> {
    const browser = await this.acquire();
    return browser.newContext(options);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Shared browser pool closed.');
    }
  }
}

export const browserPool = new PlaywrightBrowserPool();
