import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeDb, fakeFieldValue, fakeFieldPath } from './fakeDb.testutil.js';

vi.mock('firebase-admin/firestore', () => ({ FieldValue: fakeFieldValue, FieldPath: fakeFieldPath }));
const { takeDailyQuota, globalCap, quotaMessage, resetGlobalCacheForTests, QUOTA_COLLECTION } = await import('./usageQuota.js');

const NOW = Date.parse('2026-10-30T18:00:00Z'); // 11 AM Pacific, Oct 30
const env = {};

beforeEach(() => resetGlobalCacheForTests());
afterEach(() => vi.restoreAllMocks());

describe('daily usage quota', () => {
  it('lets a caller through up to the per-account cap, then stops them', async () => {
    const db = fakeDb();
    for (let i = 0; i < 60; i++) expect((await takeDailyQuota('ai-verify', { uid: 'u1', db, now: NOW, env })).ok).toBe(true);
    expect(await takeDailyQuota('ai-verify', { uid: 'u1', db, now: NOW, env })).toEqual({ ok: false, reason: 'user' });
    // Someone else still has their own allowance.
    expect((await takeDailyQuota('ai-verify', { uid: 'u2', db, now: NOW, env })).ok).toBe(true);
    expect(db.docs[`${QUOTA_COLLECTION}/2026-10-30_ai-verify_uid-u1`].count).toBe(60);
  });

  it('resets on the next Pacific day', async () => {
    const db = fakeDb({ [`${QUOTA_COLLECTION}/2026-10-30_ai-verify_uid-u1`]: { count: 60 } });
    expect((await takeDailyQuota('ai-verify', { uid: 'u1', db, now: NOW, env })).ok).toBe(false);
    expect((await takeDailyQuota('ai-verify', { uid: 'u1', db, now: NOW + 24 * 3600 * 1000, env })).ok).toBe(true);
  });

  it('gives signed-out callers the lower per-IP cap, and none on AI routes', async () => {
    const db = fakeDb({ [`${QUOTA_COLLECTION}/2026-10-30_google-nearby_ip-1.2.3.4`]: { count: 30 } });
    expect(await takeDailyQuota('google-nearby', { ip: '1.2.3.4', db, now: NOW, env })).toEqual({ ok: false, reason: 'user' });
    expect((await takeDailyQuota('google-nearby', { ip: '5.6.7.8', db, now: NOW, env })).ok).toBe(true);
    expect((await takeDailyQuota('ai-plan', { ip: '5.6.7.8', db, now: NOW, env })).ok).toBe(false);
  });

  it('trips the global breaker across all accounts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = fakeDb({ [`${QUOTA_COLLECTION}/2026-10-30_ai-plan_all`]: { count: 3 } });
    const capped = { AI_DAILY_GLOBAL_CAP: '4' };
    expect((await takeDailyQuota('ai-plan', { uid: 'a', db, now: NOW, env: capped })).ok).toBe(true);
    expect(await takeDailyQuota('ai-plan', { uid: 'b', db, now: NOW, env: capped })).toEqual({ ok: false, reason: 'global' });
    expect(db.docs[`${QUOTA_COLLECTION}/2026-10-30_ai-plan_all`].count).toBe(4);
  });

  it('fails open when Firestore is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = { collection: () => { throw new Error('down'); } };
    expect(await takeDailyQuota('ai-plan', { uid: 'u', db, now: NOW, env })).toEqual({ ok: true });
  });

  it('reads global caps from env, ignoring junk', () => {
    expect(globalCap('ai-plan', { AI_DAILY_GLOBAL_CAP: '500' })).toBe(500);
    expect(globalCap('ai-plan', { AI_DAILY_GLOBAL_CAP: 'lots' })).toBe(20000);
  });

  it('words the two limits differently', () => {
    expect(quotaMessage('user', 'Mapr')).toMatch(/today's limit for mapr/);
    expect(quotaMessage('global', 'Mapr')).toMatch(/paused for everyone/);
  });
});
