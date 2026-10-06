import { createReadStream, existsSync, statSync, watchFile } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { EVENTS_FILE, OUT_DIR, eventLogger, parseArgs, runPipeline } from './pipeline.js';

// Live dashboard: http://localhost:3000
//   node server.js           start a full training run and watch it
//   node server.js --quick   small run (2 sims, 300/600/1,000 users, 4 epochs)
//   node server.js --view    only watch: replays output/events.jsonl and
//                            follows it while another process (npm run train) writes
// Every browser gets the whole run so far on connect, then each new event.

const here = path.dirname(fileURLToPath(import.meta.url));
const opt = parseArgs();
const port = opt.port || Number(process.env.PORT) || 3000;

const app = express();
app.get('/', (_req, res) => res.sendFile(path.join(here, 'dashboard.html')));
app.get('/vendor/chart.umd.js', (_req, res) => res.sendFile(path.join(here, 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));
// The small result files only; the 100 MB synthetic data stays off the wire.
const SHAREABLE = /^(learning-curve\.csv|final-report\.csv|summary\.json|batch-[ABC]-results\.json)$/;
app.get('/output/:file', (req, res) => {
  if (!SHAREABLE.test(req.params.file)) return res.status(404).end();
  const file = path.join(OUT_DIR, req.params.file);
  if (!existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Tail events.jsonl: whatever process writes it, every client sees it.
let offset = 0;
let partial = '';
const backlog = [];
function readNew() {
  if (!existsSync(EVENTS_FILE)) return;
  const size = statSync(EVENTS_FILE).size;
  if (size < offset) {
    // A new run truncated the file.
    offset = 0;
    partial = '';
    backlog.length = 0;
    broadcast({ type: 'reset' });
  }
  if (size === offset) return;
  const stream = createReadStream(EVENTS_FILE, { start: offset, end: size - 1, encoding: 'utf8' });
  offset = size;
  let text = '';
  stream.on('data', (c) => (text += c));
  stream.on('end', () => {
    const lines = (partial + text).split('\n');
    partial = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        backlog.push(e);
        broadcast(e);
      } catch {
        /* half-written line: skip */
      }
    }
  });
}

function broadcast(e) {
  const msg = JSON.stringify(e);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'replay', events: backlog }));
});

readNew();
watchFile(EVENTS_FILE, { interval: 400 }, readNew);
setInterval(readNew, 1000);

server.listen(port, () => {
  console.log(`Mapr synthetic training dashboard: http://localhost:${port}`);
  if (opt.view) {
    console.log(existsSync(EVENTS_FILE) ? `Following ${EVENTS_FILE}` : 'No run yet: start one with npm run train');
    return;
  }
  const emit = eventLogger();
  runPipeline({ ...opt, emit }).catch((e) => {
    emit({ type: 'error', text: e?.stack || String(e) });
    console.error(e);
  });
});

