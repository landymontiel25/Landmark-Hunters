import { describe, it, expect, vi } from 'vitest';
import { isStoragePhotoUrl, photoShowsPlace, photoMatchesMission } from './photoCheck.js';
import { PHOTO_CHECK_MODEL } from './aiModels.js';

const URL_OK = 'https://firebasestorage.googleapis.com/v0/b/app/o/x.jpg?alt=media&token=t';
const place = { name: 'Hard Rock Stadium', kinds: 'Sports', city: 'Miami' };
const reply = (json, extra = {}) => ({ stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', name: 'photo_verdict', input: json }], ...extra });
const clientWith = (msg) => ({ messages: { create: vi.fn(async () => msg) } });

describe('photoCheck', () => {
  it('only checks the app\'s own stored photos', async () => {
    expect(isStoragePhotoUrl(URL_OK)).toBe(true);
    expect(isStoragePhotoUrl('https://example.com/x.jpg')).toBe(false);
    expect(isStoragePhotoUrl('http://firebasestorage.googleapis.com/x')).toBe(false);
    const client = clientWith(reply({ matches: true, reason: 'x' }));
    expect(await photoShowsPlace({ url: 'https://evil.example/a.jpg', place, client })).toEqual({ ok: false, reason: 'not an app photo' });
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('sends the photo and the place, and reads the yes or no', async () => {
    const client = clientWith(reply({ matches: true, reason: 'The stadium from the stands.' }));
    const out = await photoShowsPlace({ url: URL_OK, place, client, log: async () => {} });
    expect(out).toEqual({ ok: true, reason: 'The stadium from the stands.' });
    const req = client.messages.create.mock.calls[0][0];
    expect(req.model).toBe(PHOTO_CHECK_MODEL);
    expect(req.tool_choice).toEqual({ type: 'tool', name: 'photo_verdict' });
    expect(req.betas).toBeUndefined();
    expect(req.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'url', url: URL_OK } });
    expect(req.messages[0].content[1].text).toContain('Hard Rock Stadium (Sports), Miami');
  });

  it('a no, a refusal or an error never pays', async () => {
    expect((await photoShowsPlace({ url: URL_OK, place, client: clientWith(reply({ matches: false, reason: 'A black image.' })), log: async () => {} })).ok).toBe(false);
    expect((await photoShowsPlace({ url: URL_OK, place, client: clientWith(reply({}, { stop_reason: 'refusal', content: [] })), log: async () => {} })).ok).toBe(false);
    const broken = { messages: { create: vi.fn(async () => { throw new Error('down'); }) } };
    expect(await photoShowsPlace({ url: URL_OK, place, client: broken, log: async () => {} })).toEqual({ ok: false, reason: 'check failed', failed: true });
  });

  it('tells the check the place is GPS-verified, and sends what is on the property', async () => {
    const client = clientWith(reply({ matches: true, reason: 'Tennis courts.' }));
    await photoShowsPlace({ url: URL_OK, place: { name: 'Resort', kinds: 'Food', city: 'Abacos', description: 'Beach resort.', scenes: ['the tennis courts', 'the marina'], radiusMeters: 400 }, client, log: async () => {} });
    const req = client.messages.create.mock.calls[0][0];
    expect(req.system).toMatch(/only when the photo clearly is not this place/);
    expect(req.system).toMatch(/GPS/);
    const text = req.messages[0].content[1].text;
    expect(text).toContain('About it: Beach resort.');
    expect(text).toContain('On the property: the tennis courts; the marina.');
    expect(text).toContain('400 meters');
  });

  it('a mission photo is checked against the mission text', async () => {
    const client = clientWith(reply({ matches: false, reason: 'A tiled floor.' }));
    const out = await photoMatchesMission({ url: URL_OK, place: { name: 'Resort', city: 'Abacos' }, mission: 'Photograph the marina with the boats and the beach.', client, log: async () => {} });
    expect(out).toEqual({ ok: false, reason: 'A tiled floor.' });
    const req = client.messages.create.mock.calls[0][0];
    expect(req.system).toMatch(/photo mission/);
    expect(req.messages[0].content[1].text).toContain('The mission: Photograph the marina with the boats and the beach.');
  });
});
