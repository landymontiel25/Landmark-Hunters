// Groups raw findings into distinct problems: same kind, same message once
// ids, numbers, hashes and URLs are stripped, same top app stack frame.
// Each group keeps a count, the screens it showed on, and the shortest
// session that hit it as the repro (seed + index replays it exactly).

export function normalize(msg) {
  return String(msg)
    .replace(/https?:\/\/[^\s"')]+/g, '<url>')
    .replace(/\b[a-zA-Z0-9]{20,}\b/g, '<id>')
    .replace(/\b\d+(\.\d+)?\b/g, '<n>')
    .replace(/sim-[\w-]+@example\.com/g, '<email>')
    .replace(/"[^"]{40,}"/g, '"<long>"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function topFrame(stack) {
  if (!stack) return '';
  const line = stack.split('\n').find((l) => /at /.test(l) && !/node_modules|chunk-|react-dom|scheduler/.test(l));
  return (line || '').replace(/-[A-Za-z0-9_-]{8}\.js/g, '.js').replace(/:\d+:\d+/g, '').trim().slice(0, 140);
}

const routeOf = (hash) =>
  String(hash || '#/')
    .replace(/\?.*$/, '')
    .replace(/^#\/landmarks\/[^/]+\/[^/]+/, '#/landmarks/:region/:id')
    .replace(/^#\/group\/[^/]+/, '#/group/:id')
    .replace(/^#\/friend\/[^/]+/, '#/friend/:uid');

export function buildReport(results, { seed, ms, workers }) {
  const groups = new Map();
  let actions = 0;
  const personaCount = {};
  const apiCalls = {};
  const unknownApi = {};
  const external = {};
  for (const r of results) {
    actions += r.actions || 0;
    if (r.persona) personaCount[r.persona.kind] = (personaCount[r.persona.kind] || 0) + 1;
    for (const [k, v] of Object.entries(r.api || {})) apiCalls[k] = (apiCalls[k] || 0) + v;
    for (const [k, v] of Object.entries(r.unknownApi || {})) unknownApi[k] = (unknownApi[k] || 0) + v;
    for (const [k, v] of Object.entries(r.external || {})) external[k] = (external[k] || 0) + v;
    const perSession = new Set();
    for (const f of r.findings) {
      const route = f.kind === 'overflow' || f.kind === 'noop' || f.kind === 'stuck' ? routeOf(f.hash) : '';
      const key = [f.kind, normalize(f.message), topFrame(f.stack), route].join(' | ');
      let g = groups.get(key);
      if (!g) {
        g = { key, kind: f.kind, message: f.message, stack: f.stack || '', count: 0, sessions: 0, routes: {}, repro: null, clicks: 0 };
        groups.set(key, g);
      }
      g.count += 1;
      const rt = routeOf(f.hash);
      g.routes[rt] = (g.routes[rt] || 0) + 1;
      if (!perSession.has(key)) {
        perSession.add(key);
        g.sessions += 1;
      }
      // Shortest path to the problem is the best repro.
      if (!g.repro || f.action < g.repro.action) {
        g.repro = { seed: r.seed, index: r.index, persona: r.persona, action: f.action, steps: r.steps.filter((s) => parseInt(s, 10) <= f.action || s.startsWith(' ')).slice(-25) };
      }
    }
  }
  // "Button did nothing" counts only when the same button never did anything.
  const list = [...groups.values()].sort((a, b) => b.sessions - a.sessions);
  const durationMin = ms / 60000;
  const summary =
    `${results.length} sessions, ${actions} actions, ${durationMin.toFixed(1)} min, ${workers} workers. ` +
    `${list.filter((g) => g.kind !== 'harness').length} distinct findings (${list.filter((g) => ['pageerror', 'boundary', 'blank'].includes(g.kind)).length} crashes/errors).`;

  const order = ['pageerror', 'boundary', 'blank', 'stuck', 'console', 'console-warning', 'requestfailed', 'http5xx', 'overflow', 'noop', 'harness'];
  let md = `# App sim report (seed ${seed})\n\n${summary}\n\nPersonas: ${JSON.stringify(personaCount)}\n\nAPI calls stubbed: ${JSON.stringify(apiCalls)}\n\nUnknown API routes: ${JSON.stringify(unknownApi)}\n\nOther hosts answered: ${JSON.stringify(external)}\n\n`;
  for (const kind of order) {
    const gs = list.filter((g) => g.kind === kind);
    if (!gs.length) continue;
    md += `## ${kind} (${gs.length})\n\n`;
    for (const g of gs.slice(0, 80)) {
      md += `### ${g.message.slice(0, 160).replace(/\n/g, ' ')}\n\n`;
      md += `- ${g.count} times in ${g.sessions} sessions; screens: ${Object.entries(g.routes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v})`).join(', ')}\n`;
      if (g.stack) md += `- stack:\n\n\`\`\`\n${g.stack}\n\`\`\`\n`;
      if (g.repro) {
        const p = g.repro.persona || {};
        md += `- repro: \`node scripts/app-sim/run.mjs --seed ${g.repro.seed} --only ${g.repro.index}\` (persona ${p.kind}, ${p.city}, location ${p.location}, ${p.viewport?.width}px), at action ${g.repro.action}\n`;
        md += `\n\`\`\`\n${g.repro.steps.join('\n')}\n\`\`\`\n`;
      }
      md += '\n';
    }
  }
  return { summary, md, json: { summary, sessions: results.length, actions, ms, workers, personaCount, apiCalls, unknownApi, external, groups: list } };
}
