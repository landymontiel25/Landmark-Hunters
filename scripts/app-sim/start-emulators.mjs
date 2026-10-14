// Starts the Firebase emulators (auth, firestore, storage) for the app
// simulation, with the repo's real security rules.
//
// The repo's firebase.json has no emulators section, so the auth emulator
// would not start from it. This writes a sim-only firebase.json (plus
// copies of the rules) into scripts/app-sim/.work/ and runs the emulators
// from there. Project id demo-lh: a demo project never reaches real
// Firebase.
//
//   node scripts/app-sim/start-emulators.mjs
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const work = join(here, '.work', 'emulators');
mkdirSync(work, { recursive: true });
for (const f of ['firestore.rules', 'firestore.indexes.json', 'storage.rules']) copyFileSync(join(root, f), join(work, f));
writeFileSync(
  join(work, 'firebase.json'),
  JSON.stringify(
    {
      firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
      storage: { rules: 'storage.rules' },
      emulators: {
        auth: { host: '127.0.0.1', port: 9099 },
        firestore: { host: '127.0.0.1', port: 8080 },
        storage: { host: '127.0.0.1', port: 9199 },
        hub: { host: '127.0.0.1', port: 4400 },
        logging: { host: '127.0.0.1', port: 4500 },
        ui: { enabled: false },
        singleProjectMode: true,
      },
    },
    null,
    2
  )
);

const child = spawn('npx', ['-y', 'firebase-tools@13.35.1', 'emulators:start', '--only', 'auth,firestore,storage', '--project', 'demo-lh'], {
  cwd: work,
  stdio: 'inherit',
  // The Firestore emulator keeps every document and listener in memory; at
  // thousands of sessions the default heap runs out and the JVM spends its
  // time in GC. -Xmx gives it room.
  env: { ...process.env, JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS || ''} -Xmx${process.env.SIM_EMULATOR_HEAP || '6g'}`.trim() },
});
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
