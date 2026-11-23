'use strict';

const http = require('node:http');
const fs = require('node:fs');
const { randomInt } = require('node:crypto');

// ZAP writes rejected keys to its log. A refused request must therefore never carry a real key,
// or any character of one. Retired keys are never sent either.
function unrelatedKey(key) {
  const pool = [...'GHJKLMNPQRSTUVWXYZghjkmnpqrstuvwxyz'].filter(char => !key.includes(char));
  if (pool.length < 8) throw new Error('Cannot build an unrelated invalid key');
  return Array.from({ length: 48 }, () => pool[randomInt(pool.length)]).join('');
}

function probe(url, key) {
  return new Promise((resolve, reject) => {
    let connected = false;
    let receivedHeaders = false;
    const headers = key === undefined ? {} : { 'X-ZAP-API-Key': key };
    const request = http.get(url, { headers, agent: false }, response => {
      receivedHeaders = true;
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('socket', socket => socket.once('connect', () => { connected = true; }));
    request.setTimeout(10000, () => request.destroy(new Error('ZAP request timed out')));
    request.on('error', error => {
      if (connected && !receivedHeaders && error.code === 'ECONNRESET') {
        resolve({ closed: true });
      } else {
        reject(error);
      }
    });
  });
}

async function verify(url, key) {
  async function version() {
    const result = await probe(url, key);
    if (result.status !== 200) throw new Error('Valid-key control failed');
    let value;
    // Parser messages quote the response, so they are never surfaced.
    try { value = JSON.parse(result.body)?.version; } catch { /* Reported below. */ }
    if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Unexpected ZAP version response');
    return value;
  }
  const expected = await version();
  console.log('Authenticated ZAP version:', expected);
  const controls = [['missing', undefined], ['invalid', unrelatedKey(key)]];
  for (const [label, credential] of controls) {
    for (let i = 0; i < 2; i++) {
      const result = await probe(url, credential);
      let payload;
      try { payload = JSON.parse(result.body); } catch { /* Empty and non-JSON replies are possible. */ }
      const denied = [401, 403].includes(result.status) ||
        ['bad_api_key', 'badApiKey'].includes(payload?.code);
      if (payload?.version || (!result.closed && !denied)) {
        throw new Error(label + '-key check inconclusive or accepted, HTTP ' + result.status);
      }
      if (await version() !== expected) throw new Error('Authenticated control changed');
      console.log(label + ' key: ' + (result.closed ? 'connection closed before HTTP response' : 'explicit refusal') +
        '; valid-key control passed');
    }
  }
  return expected;
}

if (require.main === module) {
  const match = /^ZAP_API_KEY=([^\r\n]+)$/m.exec(fs.readFileSync(__dirname + '/.env', 'utf8'));
  if (!match) throw new Error('Missing ZAP_API_KEY in .env');
  verify('http://127.0.0.1:8090/JSON/core/view/version/', match[1]).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = verify;
module.exports.unrelatedKey = unrelatedKey;
