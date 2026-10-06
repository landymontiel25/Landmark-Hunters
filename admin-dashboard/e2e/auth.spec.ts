import { test, expect } from '@playwright/test';

const PASSWORD = 'e2e-password-0123456789abcdef';

test('the dashboard is closed until you sign in', async ({ page, request }) => {
  await page.goto('/dashboard/growth');
  await expect(page).toHaveURL(/\/login$/);
  const api = await request.post('/api/firestore-read');
  expect(api.status()).toBe(401);
  const jobs = await request.post('/api/jobs', { data: { action: 'mapr-run' } });
  expect(jobs.status()).toBe(401);
});

test('login, navigate, offline fallback, logout', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Wrong password.')).toBeVisible();

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  // No service-account key in this run: the page says so instead of breaking.
  await expect(page.getByText(/Can't connect to Firestore/)).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Dashboard' });
  for (const name of ['Mapr Phase 1', 'Growth', 'Retention', 'Engagement', 'Accuracy', 'Taste', 'App metrics', 'Tools']) {
    await nav.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  }

  await nav.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});
