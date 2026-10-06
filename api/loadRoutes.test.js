import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Vercel runs each api/*.js under plain Node ESM, not Vite. Import every
// route in a fresh Node process (no Firebase secret set) and call the two
// admin routes with no sign-in, so a bad import, a CommonJS/ESM clash or a
// package that crashes on load fails here instead of as a bare 500 in prod.
const dir = path.dirname(fileURLToPath(import.meta.url));
const routes = readdirSync(dir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
const env = { ...process.env, FIREBASE_SERVICE_ACCOUNT: '' };

const run = (code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env, encoding: 'utf8', timeout: 60000 });

describe('api routes load under plain Node', () => {
  it.each(routes)('%s', (file) => {
    const out = run(`const m = await import('./${file}'); console.log(typeof m.default);`);
    expect(out.trim()).toBe('function');
  });

  it('admin routes answer 401 without a token, and the Admin SDK helpers import', () => {
    const out = run(`
      const call = async (f) => { const m = await import(f); let code; const res = { status: (c) => { code = c; return res; }, json: () => res, end: () => res, setHeader() {} };
        await m.default({ method: 'GET', headers: {}, body: {} }, res); return code; };
      const a = await call('./admin-jobs.js');
      const b = await call('./study-summary.js');
      const fa = await import('./_lib/firebaseAdmin.js');
      console.log(JSON.stringify([a, b, typeof fa.adminAuth, typeof fa.adminMessaging]));
    `);
    const [a, b] = JSON.parse(out.trim().split('\n').pop());
    // admin-jobs: 503 when ADMIN_JOBS_SECRET is unset, 401 with it set; never open.
    expect([401, 503]).toContain(a);
    expect([401, 403, 503]).toContain(b);
  });
});
