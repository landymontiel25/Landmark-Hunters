import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Firestore Emulator only. Returns null when no emulator is configured, and
// throws rather than ever talking to a real project: FIRESTORE_EMULATOR_HOST
// must point at this machine, and the project id is a local-only name.

export const EMULATOR_PROJECT = 'landmark-hunters-emulator';
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+$/;

export function emulatorDb() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) return null;
  if (!LOCAL.test(host)) throw new Error(`Refusing to write: FIRESTORE_EMULATOR_HOST=${host} is not a local emulator`);
  const app = getApps().find((a) => a.name === 'emulator-context') || initializeApp({ projectId: EMULATOR_PROJECT }, 'emulator-context');
  return getFirestore(app);
}

export async function emulatorReachable(host = process.env.FIRESTORE_EMULATOR_HOST) {
  if (!host) return false;
  try {
    const res = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Writes rows with BulkWriter. rowToDoc(row) -> [id, data].
export async function writeCollection(db, collection, rows, rowToDoc, { onProgress = null, every = 5000 } = {}) {
  const writer = db.bulkWriter();
  let done = 0;
  for (const row of rows) {
    const [id, data] = rowToDoc(row);
    writer.set(db.collection(collection).doc(id), data).then(() => {
      done++;
      if (onProgress && done % every === 0) onProgress(done);
    });
  }
  await writer.close();
  onProgress?.(done);
  return done;
}
