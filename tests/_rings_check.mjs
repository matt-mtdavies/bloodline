import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const execPath = '/home/user/bloodline/node_modules/playwright-core/.local-browsers/chromium-1169/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: execPath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://localhost:5173/');
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(__dirname, 'screenshots/rings_default.png') });

// Click on James to open profile, then close
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(__dirname, 'screenshots/rings_tree.png') });

await browser.close();
console.log('screenshots taken');
