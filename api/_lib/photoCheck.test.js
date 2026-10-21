import { describe, it, expect, vi } from 'vitest';
import { isStoragePhotoUrl, photoShowsPlace } from './photoCheck.js';
import { PHOTO_CHECK_MODEL } from './aiModels.js';

const URL_OK = 'https://firebasestorage.googleapis.com/v0/b/app/o/x.jpg?alt=media&token=t';
const place = { name: 'Hard Rock Stadium', kinds: 'Sports', city: 'Miami' };
const reply = (json, extra = {}) => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(json) }], ...extra });
const clientWith = (msg) => ({ beta: { messages: { create: vi.fn(async () => msg) } } });

describe('photoCheck', () => {
  it('only checks the app\'s own stored photos', async () => {
    expect(isStoragePhotoUrl(URL_OK)).toBe(true);
    expect(isStoragePhotoUrl('https://example.com/x.jpg')).toBe(false);
    expect(isStoragePhotoUrl('http://firebasestorage.googleapis.com/x')).toBe(false);
    const client = clientWith(reply({ shows_place: true, reason: 'x' }));
    expect(await photoShowsPlace({ url: 'https://evil.example/a.jpg', place, client })).toEqual({ ok: false, reason: 'not an app photo' });
    expect(client.beta.messages.create).not.toHaveBeenCalled();
  });

  it('sends the photo and the place, and reads the yes or no', async () => {
    const client = clientWith(reply({ shows_place: true, reason: 'The stadium from the stands.' }));
    const out = await photoShowsPlace({ url: URL_OK, place, client, log: async () => {} });
    expect(out).toEqual({ ok: true, reason: 'The stadium from the stands.' });
    const req = client.beta.messages.create.mock.calls[0][0];
    expect(req.model).toBe(PHOTO_CHECK_MODEL);
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'url', url: URL_OK } });
    expect(req.messages[0].content[1].text).toContain('Hard Rock Stadium (Sports), Miami');
  });

  it('a no, a refusal or an error never pays', async () => {
    expect((await photoShowsPlace({ url: URL_OK, place, client: clientWith(reply({ shows_place: false, reason: 'A black image.' })), log: async () => {} })).ok).toBe(false);
    expect((await photoShowsPlace({ url: URL_OK, place, client: clientWith(reply({}, { stop_reason: 'refusal', content: [] })), log: async () => {} })).ok).toBe(false);
    const broken = { beta: { messages: { create: vi.fn(async () => { throw new Error('down'); }) } } };
    expect(await photoShowsPlace({ url: URL_OK, place, client: broken, log: async () => {} })).toEqual({ ok: false, reason: 'check failed' });
  });
});
