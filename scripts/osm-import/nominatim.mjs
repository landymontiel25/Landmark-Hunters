// Nominatim search with its usage policy kept across every process on this
// machine: at most one request a second (a shared timestamp file under a
// lock, so the locator and research agents' checks can run side by side),
// a User-Agent naming the app, and every reply cached by its query in
// <cacheDir> so a rerun never asks twice.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA = 'LandmarkHunters-osm-import/1.0 (https://landmarkhunters.com; https://github.com/landymontiel25/Landmark-Hunters)';
const API = 'https://nominatim.openstreetmap.org/search';
const GAP_MS = 1100;
// One lock for every region's cache, so two regions' runs share the one-a-second limit.
const LOCK_DIR = new URL('./data/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits for this process's turn: takes the lock (a directory), waits until
// GAP_MS after the last request any process made, stamps the time, releases.
async function turn() {
  const dir = LOCK_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.lock');
  const stamp = path.join(dir, '.last');
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch {
      // A lock left by a killed process goes stale after 30 s.
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.rmdirSync(lock);
      } catch {}
      await sleep(100 + Math.random() * 200);
    }
  }
  try {
    const last = fs.existsSync(stamp) ? Number(fs.readFileSync(stamp, 'utf8')) || 0 : 0;
    await sleep(Math.max(0, last + GAP_MS - Date.now()));
    fs.writeFileSync(stamp, String(Date.now()));
  } finally {
    fs.rmdirSync(lock);
  }
}

export async function nominatim(cacheDir, params) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const q = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', extratags: '1', namedetails: '1', limit: '10', countrycodes: 'us', ...params });
  const file = path.join(cacheDir, `${crypto.createHash('sha1').update(q.toString()).digest('hex')}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; ; attempt++) {
    await turn();
    try {
      const r = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`Nominatim ${r.status}`);
      const data = await r.json();
      fs.writeFileSync(file, JSON.stringify(data));
      return data;
    } catch (e) {
      if (attempt >= 5) throw e;
      console.warn(`retry ${attempt}: ${e.message}`);
      await sleep(5000 * attempt);
    }
  }
}
