import { defineConfig } from '@playwright/test';

// E2E against a production build (npm run build first). No Firebase config:
// this covers the auth flow, the route guard, navigation and the offline
// fallback. CHROMIUM_PATH points at a preinstalled browser when needed.
const PORT = 3123;
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    env: { ADMIN_SECRET_TOKEN: 'e2e-password-0123456789abcdef', JWT_SECRET: 'e2e-jwt-secret-0123456789abcdef0123456789', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
