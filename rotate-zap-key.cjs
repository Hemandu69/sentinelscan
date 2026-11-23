'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const verify = require('./verify-zap.cjs');

const root = __dirname;
const origin = 'http://127.0.0.1:8090';
const versionPath = '/JSON/core/view/version/';
const envFile = path.join(root, '.env');
const apiEnv = path.join(root, '../sentinelscan-api/.env');
class RotationError extends Error {}
function fail(message) { throw new RotationError(message); }
function command(program, args, step) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', timeout: 220000, windowsHide: true });
  if (result.status !== 0) fail(step + ' failed.');
  return result.stdout.trim();
}
const docker = (...args) => command('docker', ['--context', 'desktop-linux', ...args], 'Docker ' + args[0]);
const compose = (...args) => docker('compose', '-p', 'sentinelscan-infrastructure', '--env-file', '.env', '-f', 'compose.yaml', ...args);
function container(service) {
  const id = compose('ps', '-q', service);
  if (!/^[a-f0-9]{12,64}$/.test(id)) fail('Expected one running ' + service + ' container.');
  return docker('inspect', '--format', '{{.Id}} {{.State.StartedAt}}', id);
}
async function read(view, key) {
  const response = await fetch(origin + view, { headers: {'X-ZAP-API-Key': key}, redirect:'error', signal:AbortSignal.timeout(6000) });
  if (!response.ok) fail('Authenticated provider preflight failed.');
  return response.json();
}
async function main() {
  if (process.platform !== 'win32') fail('Run from Windows PowerShell on the Docker host.');
  if ('ZAP_API_KEY' in process.env || 'ZAP_API_KEY' in parseEnv(fs.readFileSync(apiEnv, 'utf8'))) {
    fail('Remove the API or shell key override before rotation. Use the infrastructure .env as the single source.');
  }
  if (docker('info', '--format', '{{.OSType}}') !== 'linux') fail('Expected the Linux Docker engine.');
  if (compose('port','zap','8090') !== '127.0.0.1:8090') fail('Unexpected ZAP binding.');
  const pg = container('postgres'), juice = container('juice-shop'), oldZap = container('zap');
  const text = fs.readFileSync(envFile, 'utf8');
  const lines = [...text.matchAll(/^ZAP_API_KEY=([^\r\n]+)\r?$/gm)];
  const old = parseEnv(text).ZAP_API_KEY;
  if (lines.length !== 1 || !old || lines[0][1] !== old) fail('Expected one unquoted ZAP key in the infrastructure .env.');
  if ((await read(versionPath, old)).version !== '2.17.0') fail('Expected ZAP 2.17.0 before rotation.');
  for (const component of ['spider','ascan']) {
    const {scans} = await read('/JSON/'+component+'/view/scans/',old);
    if (!Array.isArray(scans) || scans.length) fail('Run inventory is nonempty or unreadable. Preserve the evidence before rotation.');
  }
  // Avoid writing a new key if another rotation or an editor changed the original file.
  const temp = path.join(root,'.env.rotation');
  const fd = fs.openSync(temp,'wx',0o600);
  const fresh = randomBytes(32).toString('hex');
  try {
    try {
      fs.writeFileSync(fd,text.replace(/^ZAP_API_KEY=[^\r\n]+/m, 'ZAP_API_KEY='+fresh));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (fs.readFileSync(envFile,'utf8') !== text) fail('The infrastructure .env changed during preflight.');
    // ReplaceFile preserves destination ACLs. No backup copy of the retired key.
    command('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      "$ErrorActionPreference='Stop'; [IO.File]::Replace((Join-Path $pwd '.env.rotation'),(Join-Path $pwd '.env'),[System.Management.Automation.Language.NullString]::Value)"],'Atomic key replacement');
  } finally { if(fs.existsSync(temp)) fs.unlinkSync(temp); }
  console.log('New credential installed in the infrastructure .env.');
  compose('up','-d','--no-deps','--force-recreate','--pull','never','--wait','--wait-timeout','180','zap');
  if (container('zap') === oldZap || container('postgres') !== pg || container('juice-shop') !== juice) fail('Unexpected container identity or restart.');
  if (compose('port','zap','8090') !== '127.0.0.1:8090') fail('Unexpected ZAP binding after recreation.');
  if (await verify(origin+versionPath,fresh,old) !== '2.17.0') fail('Unexpected ZAP version after rotation.');
  console.log('Rotation verified. Restart the Fastify process to reload its key.');
}
if (require.main === module) main().catch(e=>{
  // Never include provider bodies, child output, process environment or system diagnostics.
  console.error(e instanceof RotationError ? e.message : 'ZAP rotation stopped. Credential or service verification did not finish.');
  process.exitCode=1;
});
