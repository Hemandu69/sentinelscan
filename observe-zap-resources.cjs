// Read-only samples of the existing Compose service. Run from Windows with Node 24.
'use strict';
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parseEnv, parseArgs } = require('node:util');
const { setTimeout: sleep } = require('node:timers/promises');

function options(args) {
  const { values } = parseArgs({ args, options: {
    count: { type: 'string', default: '1' },
    'interval-seconds': { type: 'string', default: '10' },
  } });
  function integer(value, min, max) {
    const n = Number(value);
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw Error();
    return n;
  }
  return { count: integer(values.count, 1, 120), interval: integer(values['interval-seconds'], 1, 60) };
}

async function observe({ count, interval }, sample, wait = sleep) {
  for (let i = 0; i < count; i++) {
    await sample(i + 1);
    if (i + 1 < count) await wait(interval * 1000);
  }
}

function docker(...args) {
  return execFileSync('docker', ['--context', 'desktop-linux', ...args], {
    cwd: __dirname, timeout: 6000, maxBuffer: 65536, windowsHide: true,
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
async function view(path, key) {
  const response = await fetch('http://127.0.0.1:8090/JSON/' + path + '/', {
    headers: { 'X-ZAP-API-Key': key }, signal: AbortSignal.timeout(4000), redirect: 'error',
  });
  if (!response.ok) throw Error();
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 131072) throw Error();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function sample() {
  let phase = 'Docker service lookup';
  console.log('Sample UTC', new Date().toISOString());
  try {
    const id = docker('compose', 'ps', '-a', '-q', 'zap');
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw Error();
    phase = 'Docker inspect';
    const state = docker('inspect', '--format',
      '{{.State.Status}} {{.State.Health.Status}} {{.State.OOMKilled}} {{.HostConfig.Memory}} {{.HostConfig.MemoryReservation}}', id);
    console.log('Container', id);
    console.log('State / health / OOMKilled / memory limit bytes / reservation bytes:', state);
    if (!state.startsWith('running healthy ')) throw Error();
    phase = 'Docker stats';
    const stats = docker('stats', '--no-stream', '--format', '{{.MemUsage}} | {{.MemPerc}} | {{.CPUPerc}}', id);
    console.log('Memory usage and limit | percent of limit | CPU:', stats);
    phase = 'ZAP version';
    const key = parseEnv(readFileSync(join(__dirname, '.env'), 'utf8')).ZAP_API_KEY;
    if (!key) throw Error();
    const version = await view('core/view/version', key);
    if (version.version !== '2.17.0') throw Error();
    console.log('Authenticated ZAP version:', version.version);
    phase = 'Active Scan inventory';
    const inventory = await view('ascan/view/scans', key);
    if (!Array.isArray(inventory.scans)) throw Error();
    for (const row of inventory.scans) {
      if (!/^\d{1,12}$/.test(String(row.id))) throw Error();
      const progress = /^(?:100|[1-9]?\d)$/.test(String(row.progress)) ? Number(row.progress) : null;
      const state = ['NOT_STARTED','RUNNING','PAUSED','FINISHED'].includes(row.state) ? row.state : 'UNKNOWN';
      console.log(JSON.stringify({ kind: 'active', id: String(row.id), progress, providerState: state }));
    }
    console.log('Active runs listed:', inventory.scans.length);
  } catch {
    throw new Error(phase + ' unavailable or unexpected. Sampling stopped.');
  }
}
if (require.main === module) {
  let settings;
  try {
    settings = options(process.argv.slice(2));
  } catch {
    console.error('Usage: node observe-zap-resources.cjs [--count 1..120] [--interval-seconds 1..60]');
    process.exitCode = 2;
  }
  if (settings) observe(settings, sample).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { options, observe };
