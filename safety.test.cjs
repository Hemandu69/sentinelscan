'use strict';
// Offline safety tests. Docker, Node and ZAP are replaced with recording fakes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRotation } = require('./rotate-zap-key.cjs');
const { createSampler, observe } = require('./observe-zap-resources.cjs');

const windows = { skip: process.platform !== 'win32' && 'Windows PowerShell only' };

// Functions take precedence over programs, so the scripts under test cannot reach the real docker or node.
function powershell(script, args, replies, stateful = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelscan-safety-'));
  try {
    fs.copyFileSync(path.join(__dirname, script), path.join(dir, script));
    fs.writeFileSync(path.join(dir, 'run.ps1'), `
$global:calls = New-Object System.Collections.ArrayList
$global:psRestarted = $false
function global:docker {
  $piped = @($input) -join ' '
  $line = $args -join ' '
  [void]$global:calls.Add($line)
  $global:LASTEXITCODE = 0
  ${stateful}
  ${replies.map(([match, reply, code = 0]) => `if ($line -like '${match}') { $global:LASTEXITCODE = ${code}; return ${reply} }`).join('\n  ')}
}
function global:node { [void]$global:calls.Add('node ' + ($args -join ' ')); $global:LASTEXITCODE = 0 }
$failed = ''
try { & (Join-Path $PSScriptRoot '${script}') ${args} | Out-Host } catch { $failed = $_.Exception.Message }
[Console]::Out.WriteLine('RESULT:' + (ConvertTo-Json -Compress @{ calls = @($global:calls); failed = $failed }))
`);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'run.ps1')],
      { encoding: 'utf8', timeout: 60000, windowsHide: true });
    const line = /^RESULT:(.*)$/m.exec(result.stdout);
    assert.ok(line, result.stdout + result.stderr);
    return JSON.parse(line[1]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const id = letter => letter.repeat(64);
const ids = { postgres: id('a'), zap: id('b'), 'juice-shop': id('c') };
const healthy = Object.entries(ids).flatMap(([service, value]) => [
  [`*ps -q ${service}`, `'${value}'`],
  [`*inspect --format*${value}`, `'${value}|2026-01-01T00:00:00Z|running|${service === 'juice-shop' ? 'none' : 'healthy'}'`],
]);
const ready = [...healthy, ['*exec -T postgres*', "'1'"]];
const mutating = /( up( |$)| create( |$)| rm( |$)| down( |$)| stop( |$)| kill | pull | restart | prune|--force-recreate)/;

test('verify.ps1 default run issues no state-changing Docker command', windows, () => {
  const run = powershell('verify.ps1', '', ready);
  assert.equal(run.failed, '');
  assert.ok(run.calls.length > 8);
  assert.deepEqual(run.calls.filter(call => mutating.test(call)), []);
});
test('verify.ps1 refuses to create a missing container', windows, () => {
  const run = powershell('verify.ps1', '', ready.filter(([match]) => match !== '*ps -q zap'));
  assert.match(run.failed, /Expected one running zap/);
  assert.deepEqual(run.calls.filter(call => mutating.test(call)), []);
});
test('verify.ps1 rejects an unhealthy service', windows, () => {
  const run = powershell('verify.ps1', '', [[`*inspect --format*${ids.zap}`, `'${ids.zap}|t|running|unhealthy'`], ...ready]);
  assert.match(run.failed, /zap is not running and healthy/);
});
test('verify.ps1 detects a container replaced during verification', windows, () => {
  const run = powershell('verify.ps1', '', ready,
    `if ($line -like '*inspect --format*${ids.zap}') { $global:n++; if ($global:n -gt 1) { return '${id('d')}|2026-01-01T00:00:00Z|running|healthy' } }`);
  assert.match(run.failed, /zap changed while/);
});
test('verify.ps1 persistence option restarts PostgreSQL only', windows, () => {
  const stateful = `if ($line -like '*exec -T postgres*') {
    if ($piped -match "^INSERT.*'([0-9a-f-]{36})'") { $global:m = $Matches[1]; return }
    if ($piped -match '^SELECT marker') { return $global:m }
    if ($piped -match '^(CREATE|DELETE)') { return }
    return '1' }`;
  const run = powershell('verify.ps1', '-PersistenceRestart', healthy, stateful);
  assert.equal(run.failed, '');
  const changes = run.calls.filter(call => mutating.test(call));
  assert.equal(changes.length, 1);
  assert.match(changes[0], /restart --no-deps postgres$/);
});

const endpoint = ['*context inspect*', "'npipe:////./pipe/dockerDesktopLinuxEngine'"];
const volumes = ['*volume ls*', "@('sentinelscan-infrastructure_pgdata','unrelated')"];
function labelled(service, project = 'sentinelscan-infrastructure') {
  const name = 'sentinelscan-infrastructure-' + service + '-1';
  const labels = JSON.stringify({ 'com.docker.compose.project': project, 'com.docker.compose.service': service });
  return [`*inspect --type container*${name}`, `'${ids[service]}|/${name}|${labels}'`];
}
test('reset script reports only, unless removal is requested', windows, () => {
  const run = powershell('reset-and-verify.ps1', '-Service postgres', [endpoint, labelled('postgres'), volumes]);
  assert.equal(run.failed, '');
  assert.deepEqual(run.calls.filter(call => mutating.test(call)), []);
});
test('reset script requires a selected SentinelScan service', windows, () => {
  for (const args of ['-Service other -Remove', "-Service '' -Remove"]) {
    const run = powershell('reset-and-verify.ps1', args, [endpoint]);
    assert.notEqual(run.failed, '');
    assert.deepEqual(run.calls, []);
  }
});
test('reset script removes only the exact selected container', windows, () => {
  const run = powershell('reset-and-verify.ps1', '-Service juice-shop -Remove', [endpoint, labelled('juice-shop'), volumes]);
  assert.equal(run.failed, '');
  assert.deepEqual(run.calls.filter(call => mutating.test(call)), [
    '--context desktop-linux stop ' + ids['juice-shop'], '--context desktop-linux rm ' + ids['juice-shop'],
  ]);
  assert.ok(!run.calls.some(call => /prune|image|network/.test(call)));
});
test('reset script touches nothing if any selected container belongs to another project', windows, () => {
  const run = powershell('reset-and-verify.ps1', '-Service postgres,juice-shop -Remove',
    [endpoint, labelled('postgres'), labelled('juice-shop', 'another-project'), volumes]);
  assert.match(run.failed, /Nothing was removed/);
  assert.deepEqual(run.calls.filter(call => mutating.test(call)), []);
});
test('reset script protects the ZAP session by default', windows, () => {
  const run = powershell('reset-and-verify.ps1', '-Service zap -Remove', [endpoint, labelled('zap'), volumes]);
  assert.match(run.failed, /DiscardZapSession/);
  assert.deepEqual(run.calls.filter(call => mutating.test(call)), []);
});
test('reset script stops at the first failed command', windows, () => {
  const run = powershell('reset-and-verify.ps1', '-Service postgres,juice-shop -Remove',
    [endpoint, labelled('postgres'), labelled('juice-shop'), volumes, ['* stop *', '$null', 1]]);
  assert.match(run.failed, /Docker command failed/);
  assert.equal(run.calls.filter(call => mutating.test(call)).length, 1);
});

function rotation(t, { images = ['sha256:' + id('e')], imageName = 'docker.io/zaproxy/zap-stable:2.17.0', scans = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelscan-rotation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = 'POSTGRES_PASSWORD=fixture-password\nZAP_API_KEY=fixture-old\n';
  fs.writeFileSync(path.join(root, '.env'), original);
  fs.writeFileSync(path.join(root, 'api.env'), 'WEB_ORIGIN=fixture\n');
  const calls = [], checked = [], logged = [];
  let inspections = 0, recreated = false;
  const run = (program, args) => {
    const line = [program, ...args].join(' ');
    calls.push(line);
    const ok = stdout => ({ status: 0, stdout });
    if (program === 'powershell.exe') {
      fs.renameSync(path.join(root, '.env.rotation'), path.join(root, '.env'));
      return ok('');
    }
    if (line.includes(' info ')) return ok('linux');
    if (line.includes(' port zap ')) return ok('127.0.0.1:8090');
    if (line.includes('config --images')) return ok(imageName);
    if (line.includes(' image inspect ')) {
      const value = images[Math.min(inspections++, images.length - 1)];
      return value ? ok(value) : { status: 1, stdout: '' };
    }
    const service = /ps -q (\S+)$/.exec(line)?.[1];
    if (service) return ok(ids[service]);
    if (line.includes(' inspect ')) return ok(line.slice(-64) + (recreated && line.endsWith(ids.zap) ? ' later' : ' earlier'));
    if (line.includes('--force-recreate')) { recreated = true; return ok(''); }
    throw Error('Unexpected command ' + line);
  };
  const request = async url => Response.json(url.endsWith('/scans/') ? { scans } : { version: '2.17.0' });
  const rotate = createRotation({ root, apiEnv: path.join(root, 'api.env'), run, request, env: {}, platform: 'win32', check: async (...args) => { checked.push(args); return '2.17.0'; }, log: line => logged.push(line) });
  const untouched = () => {
    assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), original);
    assert.ok(!fs.existsSync(path.join(root, '.env.rotation')));
    assert.ok(!calls.some(call => call.includes('--force-recreate') || call.startsWith('powershell')));
  };
  return { rotate, calls, checked, logged, root, untouched };
}
test('rotation leaves the credential alone when the image is missing', async t => {
  const f = rotation(t, { images: [null] });
  await assert.rejects(f.rotate(), /unavailable locally/);
  f.untouched();
});
test('rotation leaves the credential alone when the image disappears or changes during preflight', async t => {
  for (const second of [null, 'sha256:' + id('f')]) {
    const f = rotation(t, { images: ['sha256:' + id('e'), second] });
    await assert.rejects(f.rotate(), /No credential was changed/);
    f.untouched();
  }
});
test('rotation rejects an ambiguous image and a nonempty run inventory', async t => {
  for (const options of [{ imageName: 'one:1\ntwo:2' }, { imageName: '' }, { scans: [{ id: '0' }] }]) {
    const f = rotation(t, options);
    await assert.rejects(f.rotate());
    f.untouched();
  }
});
test('rotation verifies the image before the first write and then completes', async t => {
  const f = rotation(t);
  await f.rotate();
  const image = f.calls.findLastIndex(call => call.includes(' image inspect '));
  const write = f.calls.findIndex(call => call.startsWith('powershell.exe'));
  const recreate = f.calls.findIndex(call => call.includes('--force-recreate'));
  assert.ok(image >= 0 && image < write && write < recreate);
  assert.match(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), /^POSTGRES_PASSWORD=fixture-password\nZAP_API_KEY=[a-f0-9]{64}\n$/);
  const fresh = /ZAP_API_KEY=(.*)/.exec(fs.readFileSync(path.join(f.root, '.env'), 'utf8'))[1];
  assert.deepEqual(f.checked, [['http://127.0.0.1:8090/JSON/core/view/version/', fresh]]);
  assert.ok(![...f.calls, ...f.logged].some(line => line.includes(fresh) || line.includes('fixture-old')));
});

function sampler(overrides = {}) {
  const lines = [], calls = [];
  const docker = (...args) => {
    calls.push(args.join(' '));
    if (args[0] === 'compose') return id('b');
    if (args[0] === 'inspect') return overrides.state ?? 'running healthy false 3221225472 0';
    return '1GiB / 3GiB | 33% | 5%';
  };
  const view = async (name, key) => {
    assert.equal(key, 'fixture-key');
    if (name.endsWith('version')) return { version: overrides.version ?? '2.17.0' };
    return { scans: overrides.scans ?? [{ id: '0', progress: '40', state: 'RUNNING', url: 'http://private.invalid/' }] };
  };
  return { lines, calls, sample: createSampler({ docker, view, readKey: () => 'fixture-key', log: (...a) => lines.push(a.join(' ')) }) };
}
test('repeated monitoring samples use read-only Docker commands and hide the key and URLs', async () => {
  const f = sampler();
  const waits = [];
  await observe({ count: 3, interval: 4 }, f.sample, async ms => { waits.push(ms); });
  assert.deepEqual(waits, [4000, 4000]);
  assert.equal(f.lines.filter(line => line.startsWith('Sample UTC')).length, 3);
  assert.equal(f.lines.filter(line => line === '{"kind":"active","id":"0","progress":40,"providerState":"RUNNING"}').length, 3);
  assert.ok(f.calls.every(call => /^(compose ps|inspect|stats) /.test(call)));
  assert.ok(!f.lines.some(line => /fixture-key|private\.invalid/.test(line)));
});
test('monitoring stops on an unhealthy container, another version or a malformed run', async () => {
  for (const [override, message] of [
    [{ state: 'exited unhealthy true 3221225472 0' }, /Docker inspect/],
    [{ version: '2.16.0' }, /ZAP version/],
    [{ scans: [{ id: 'x' }] }, /Active Scan inventory/],
  ]) {
    const f = sampler(override);
    let waited = false;
    await assert.rejects(observe({ count: 2, interval: 1 }, f.sample, async () => { waited = true; }), message);
    assert.equal(waited, false);
  }
  const oom = sampler({ state: 'exited unhealthy true 3221225472 0' });
  await assert.rejects(oom.sample());
  assert.ok(oom.lines.some(line => line.includes('exited unhealthy true')), 'OOM state is reported before stopping');
});
test('monitoring reports unrecognized states and progress as unknown', async () => {
  const f = sampler({ scans: [{ id: '1', progress: '140', state: 'OTHER' }] });
  await f.sample();
  assert.ok(f.lines.includes('{"kind":"active","id":"1","progress":null,"providerState":"UNKNOWN"}'));
});
