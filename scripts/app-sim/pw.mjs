// Loads Playwright without adding it to package.json: the repo's own
// node_modules first, then the global install (npm root -g). Chromium comes
// from PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers); this never runs
// `playwright install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

function load() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(join(globalRoot, 'playwright'));
  }
}

export const { chromium } = load();

// Chromium binary to launch when the installed Playwright expects a
// different browser build than the one on disk.
export function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = join(base, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}
