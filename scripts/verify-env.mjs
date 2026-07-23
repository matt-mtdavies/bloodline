import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const failures = [];
const notes = [];
const warnings = [];

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20 || nodeMajor >= 25) {
  failures.push(`Node ${process.versions.node} is unsupported; use Node 20–24 (Node 20 is pinned in .nvmrc).`);
} else {
  notes.push(`Node ${process.versions.node}`);
}

for (const dependency of ['playwright', 'workbox-window']) {
  try {
    require.resolve(`${dependency}/package.json`);
    notes.push(`${dependency} installed`);
  } catch {
    failures.push(`${dependency} is missing; run npm ci using package-lock.json.`);
  }
}

try {
  const { chromium } = await import('playwright');
  const executable = chromium.executablePath();
  const browserPathSource = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? `PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH}`
    : 'Playwright default cache';
  if (!existsSync(executable)) {
    failures.push(`Playwright Chromium is missing; run npm run browser:install. Checked ${executable} (${browserPathSource}).`);
  } else {
    notes.push(`Playwright Chromium installed at ${executable} (${browserPathSource})`);
    try {
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      notes.push('Playwright Chromium launches');
    } catch (error) {
      const detail = String(error?.message || error).split('\n')[0];
      if (process.env.ALLOW_BROWSER_SANDBOX_FALLBACK === '1') {
        warnings.push(`Chromium could not launch (${detail}). An external browser fallback was explicitly allowed; verify the local app there and record that the CLI smoke test did not run.`);
      } else {
        failures.push(`Chromium is installed at ${executable} but cannot launch (${detail}). Set ALLOW_BROWSER_SANDBOX_FALLBACK=1 only when a supported external browser will verify the app instead.`);
      }
    }
  }
} catch {
  // The dependency failure above already gives the actionable install command.
}

if (failures.length) {
  console.error('Verification environment is not ready:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('Verification environment ready:');
for (const note of notes) console.log(`  ✓ ${note}`);
for (const warning of warnings) console.warn(`  ! ${warning}`);
