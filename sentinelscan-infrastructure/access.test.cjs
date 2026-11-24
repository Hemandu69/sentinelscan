'use strict';
// Runs the access script against temporary fixture files only. BUILTIN\Users stands in for the removed group.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const windows = { skip: process.platform !== 'win32' && 'Windows only' };
const script = path.join(__dirname, 'restrict-secret-access.ps1');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinelscan-acl-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'backups'));
  for (const name of ['backups/archive', '.env']) fs.writeFileSync(path.join(root, name), 'fixture');
  const grant = spawnSync('icacls', [root, '/grant', '*S-1-5-32-545:(OI)(CI)RX'], { encoding: 'utf8' });
  assert.equal(grant.status, 0);
  const targets = [path.join(root, 'backups'), path.join(root, '.env')];
  const run = (args = '') => {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `& '${script}' -Principal 'BUILTIN\\Users' -Path '${targets[0]}','${targets[1]}' ${args}`], { encoding: 'utf8', timeout: 60000 });
    return { status: result.status, text: result.stdout + result.stderr };
  };
  const sddl = name => spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `(Get-Acl -LiteralPath '${path.join(root, name)}').Sddl`], { encoding: 'utf8' }).stdout.trim();
  return { root, run, sddl };
}
const names = ['backups', 'backups/archive', '.env'];
test('access report changes nothing', windows, t => {
  const f = fixture(t);
  const before = names.map(f.sddl);
  assert.ok(before.every(value => value.includes(';;;BU)')));
  const result = f.run();
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /REMOVE BUILTIN\\Users/);
  assert.match(result.text, /Report only/);
  assert.deepEqual(names.map(f.sddl), before);
});
test('apply removes only the selected principal and is repeatable', windows, t => {
  const f = fixture(t);
  const before = names.map(f.sddl);
  const others = sddl => [...sddl.matchAll(/;;;([^)]+)\)/g)].map(m => m[1]).filter(who => who !== 'BU').sort();
  const owner = sddl => /^O:(.*?)G:/.exec(sddl)[1];
  const result = f.run('-Apply');
  assert.equal(result.status, 0, result.text);
  names.map(f.sddl).forEach((value, i) => {
    assert.ok(!value.includes(';;;BU)'), names[i]);
    assert.deepEqual(others(value), others(before[i]), names[i]);
    assert.equal(owner(value), owner(before[i]));
  });
  fs.writeFileSync(path.join(f.root, 'backups', 'later'), 'fixture');
  assert.ok(!f.sddl('backups/later').includes(';;;BU)'), 'new backups stay restricted');
  assert.equal(fs.readFileSync(path.join(f.root, '.env'), 'utf8'), 'fixture');
  assert.match(f.run('-Apply').text, /Nothing to remove/);
});
test('owner, SYSTEM and Administrators cannot be removed; a missing path stops before any change', windows, t => {
  const f = fixture(t);
  const before = names.map(f.sddl);
  for (const principal of ['NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators', os.userInfo().username]) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `& '${script}' -Principal '${principal}' -Path '${path.join(f.root, '.env')}' -Apply`], { encoding: 'utf8' });
    assert.match(result.stderr, /Refusing to remove/);
  }
  const missing = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `& '${script}' -Principal 'BUILTIN\\Users' -Path '${path.join(f.root, '.env')}','${path.join(f.root, 'absent')}' -Apply`], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.deepEqual(names.map(f.sddl), before);
});
