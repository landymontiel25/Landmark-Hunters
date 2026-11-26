import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isStoragePhotoUrl, photoShowsPlace, photoMatchesMission, downloadImage, VERDICT_FORMAT, MISSION_VERDICT_FORMAT } from './photoCheck.js';
import { PHOTO_CHECK_MODEL, MISSION_PHOTO_CHECK_MODEL } from './aiModels.js';

const URL_OK = 'https://firebasestorage.googleapis.com/v0/b/app/o/x.jpg?alt=media&token=t';
const place = { name: 'Hard Rock Stadium', kinds: 'Sports', city: 'Miami' };
const reply = (json, extra = {}) => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(json) }], ...extra });
const clientWith = (msg) => ({ messages: { create: vi.fn(async () => msg) } });
// A tiny JPEG, as the server downloads it.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const JPEG_B64 = Buffer.from(JPEG).toString('base64');
const okImage = () => ({ ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => JPEG.buffer.slice(0) });
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => okImage()));
});

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
    // Opus 5.5 400s on a forced tool_choice: the verdict is structured JSON.
    expect(req.tool_choice).toBeUndefined();
    expect(req.tools).toBeUndefined();
    expect(req.output_config.format).toEqual(VERDICT_FORMAT);
    expect(req.max_tokens).toBeGreaterThanOrEqual(2048);
    expect(req.betas).toBeUndefined();
    // Sent as image data, never as a link for the AI service to fetch.
    expect(req.messages[0].content.filter((b) => b.type === 'image')).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG_B64 } }]);
    expect(fetch).toHaveBeenCalledWith(URL_OK, expect.anything());
    expect(req.messages[0].content.at(-1).text).toContain('Hard Rock Stadium (Sports), Miami');
  });

  it('a no, a refusal or an error never pays', async () => {
    expect((await photoShowsPlace({ url: URL_OK, place, client: clientWith(reply({ matches: false, reason: 'A black image.' })), log: async () => {} })).ok).toBe(false);
    expect((await photoShowsPlace({ url: URL_OK, place, client: clientWith(reply({}, { stop_reason: 'refusal', content: [] })), log: async () => {} })).ok).toBe(false);
    const broken = { messages: { create: vi.fn(async () => { throw new Error('down'); }) } };
    expect(await photoShowsPlace({ url: URL_OK, place, client: broken, log: async () => {} })).toEqual({ ok: false, reason: 'check failed', failed: true });
  });

  it('a reply with no readable verdict is a failed check, recorded, never a pass', async () => {
    const client = clientWith({ stop_reason: 'max_tokens', usage: {}, content: [{ type: 'text', text: '{"matches": tr' }] });
    expect(await photoShowsPlace({ url: URL_OK, place, client, log: async () => {} })).toEqual({ ok: false, reason: 'check failed', failed: true });
  });

  it('tells the check the place is GPS-verified, and sends what is on the property', async () => {
    const client = clientWith(reply({ matches: true, reason: 'Tennis courts.' }));
    await photoShowsPlace({ url: URL_OK, place: { name: 'Resort', kinds: 'Food', city: 'Abacos', description: 'Beach resort.', scenes: ['the tennis courts', 'the marina'], radiusMeters: 400 }, client, log: async () => {} });
    const req = client.messages.create.mock.calls[0][0];
    expect(req.system).toMatch(/only when the photo clearly is not this place/);
    expect(req.system).toMatch(/GPS/);
    const text = req.messages[0].content.at(-1).text;
    expect(text).toContain('About it: Beach resort.');
    expect(text).toContain('On the property: the tennis courts; the marina.');
    expect(text).toContain('400 meters');
  });

  it('a mission photo is checked against the mission text, on Haiku, answered in two short phrases', async () => {
    const client = clientWith(reply({ matches: false, missing: 'marina, boats, beach', shows: 'a tiled floor.' }));
    const out = await photoMatchesMission({ url: URL_OK, place: { name: 'Resort', city: 'Abacos' }, mission: 'Photograph the marina with the boats and the beach.', client, log: async () => {} });
    expect(out).toEqual({ ok: false, reason: 'Missing: marina, boats, beach · You took: a tiled floor', missing: 'marina, boats, beach', shows: 'a tiled floor' });
    const req = client.messages.create.mock.calls[0][0];
    expect(req.model).toBe(MISSION_PHOTO_CHECK_MODEL);
    expect(req.output_config).toEqual({ format: MISSION_VERDICT_FORMAT }); // Haiku 4.5: no effort
    expect(req.system).toMatch(/photo mission/);
    // Loosened (owner, 2026-11-23): the main subject is enough.
    expect(req.system).toMatch(/even if other things the mission names are missing/);
    expect(req.messages[0].content.at(-1).text).toContain('The mission: Photograph the marina with the boats and the beach.');
  });

  it('sends the place\'s own catalog photos first, as labelled references (Wikimedia only, two at most)', async () => {
    const client = clientWith(reply({ matches: true, reason: 'ok' }));
    const images = ['https://upload.wikimedia.org/a.jpg', 'https://upload.wikimedia.org/b.jpg', 'https://upload.wikimedia.org/c.jpg', 'https://lh3.googleusercontent.com/x'];
    // Each downloaded image carries its own address as data, to see the order.
    const fetchImage = async (u) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: u } });
    await photoShowsPlace({ url: URL_OK, place: { ...place, images }, client, log: async () => {}, fetchImage });
    const content = client.messages.create.mock.calls[0][0].messages[0].content;
    const imgs = content.filter((b) => b.type === 'image').map((b) => b.source.data);
    expect(imgs).toEqual(['https://upload.wikimedia.org/a.jpg', 'https://upload.wikimedia.org/b.jpg', URL_OK]);
    expect(content[0].text).toMatch(/Reference photos of the place/);
  });
});

describe('photos sent as data (owner, 2026-11-25: "robots.txt" failed every photo bonus)', () => {
  const WIKI = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Place.jpg';
  const reply2 = (json) => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify(json) }] });

  it('a reference photo that will not download is left out; the check still runs', async () => {
    const client = { messages: { create: vi.fn(async () => reply2({ matches: true, reason: 'The harbour.' })) } };
    const fetchImage = vi.fn(async (u) => (u === WIKI ? null : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } }));
    const out = await photoShowsPlace({ url: 'https://firebasestorage.googleapis.com/v0/b/app/o/x.jpg', place: { name: 'Harbour', images: [WIKI] }, client, log: async () => {}, fetchImage });
    expect(out.ok).toBe(true);
    const content = client.messages.create.mock.calls[0][0].messages[0].content;
    expect(content.filter((b) => b.type === 'image')).toHaveLength(1);
    expect(JSON.stringify(content)).not.toContain('"type":"url"');
  });

  it("the traveler's photo not loading is a failed check (tried again later), never a no", async () => {
    const client = { messages: { create: vi.fn() } };
    const onError = vi.fn();
    const out = await photoShowsPlace({ url: 'https://firebasestorage.googleapis.com/v0/b/app/o/x.jpg', place: { name: 'Harbour' }, client, log: async () => {}, fetchImage: async () => null, onError });
    expect(out).toEqual({ ok: false, reason: 'check failed', failed: true });
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('downloads only real images, under the size limit', async () => {
    const res = (bytes, type = 'image/jpeg', ok = true) => async () => ({ ok, headers: { get: () => type }, arrayBuffer: async () => new Uint8Array(bytes).buffer });
    expect(await downloadImage('u', { fetchImpl: res([0xff, 0xd8, 1]) })).toMatchObject({ source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(await downloadImage('u', { fetchImpl: res([0x89, 0x50, 0x4e, 0x47, 1], 'application/octet-stream') })).toMatchObject({ source: { media_type: 'image/png' } });
    expect(await downloadImage('u', { fetchImpl: res([60, 104, 116], 'text/html') })).toBeNull();
    expect(await downloadImage('u', { fetchImpl: res([0xff, 0xd8], 'image/jpeg', false) })).toBeNull();
    expect(await downloadImage('u', { fetchImpl: async () => { throw new Error('offline'); } })).toBeNull();
  });
});
