// Proves the egress guard on throwaway containers of the ZAP image. The real ZAP container is
// never touched, nothing is scanned, and only the containers created here are removed.
"use strict";
const { execFileSync, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const client = "sentinelscan-egress-check-client",
  server = "sentinelscan-egress-check-server",
  network = "sentinelscan-infrastructure_local";
const docker = (...args) =>
  execFileSync("docker", ["--context", "desktop-linux", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).trim();
const guard = (...args) =>
  docker("run", "--rm", "--network", "container:" + client, "--cap-drop", "ALL", "--cap-add", "NET_ADMIN",
    "--security-opt", "no-new-privileges", "--tmpfs", "/tmp", "sentinelscan-egress-guard:1", ...args);
// Same image and user as ZAP. Returns the final HTTP status, or "blocked".
const fetch = (url, ...extra) => {
  const run = spawnSync("docker", ["--context", "desktop-linux", "exec", client, "curl", "-sS", "-L", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "6", ...extra, url], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : "blocked";
};
const remove = () => {
  for (const name of [client, server]) spawnSync("docker", ["--context", "desktop-linux", "rm", "-f", name]);
};
const ip = (name) => docker("inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", name);
const key = require("node:crypto").randomBytes(16).toString("hex");
// A real request by a real ZAP, following redirects. Returns whether any response came from the address.
let step = "";
async function zap(path, params = {}) {
  step = path + " " + JSON.stringify(params);
  const url = new URL("http://127.0.0.1:18090/JSON/" + path + "/");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Promise((resolve, reject) => {
    // ZAP recognizes its own API by the port it listens on.
    const req = require("node:http").get(url, { agent: false, headers: { "X-ZAP-API-Key": key, Host: "127.0.0.1:8090" }, timeout: 60000 }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}
async function zapFetch(url) {
  const { accessUrl } = await zap("core/action/accessUrl", { url, followRedirects: "true" });
  return (accessUrl ?? []).filter((m) => /^HTTP\/\S+ [1-5]\d\d/.test(m.responseHeader ?? "")).map((m) => m.requestHeader.split(" ")[1]);
}
(async () => { try {
  remove();
  docker("run", "-d", "--name", client, "--network", network, "-p", "127.0.0.1:18090:8090", "--memory", "1200m",
    "zaproxy/zap-stable:2.17.0", "zap.sh", "-daemon", "-silent", "-host", "0.0.0.0", "-port", "8090", "-Xmx512m",
    "-config", "api.key=" + key, "-config", "api.addrs.addr.name=.*", "-config", "api.addrs.addr.regex=true");
  // A hostile website: every path answers with a redirect to the address in the query.
  docker("run", "-d", "--name", server, "--network", network, "--entrypoint", "/nodejs/bin/node", "bkimminich/juice-shop:latest", "-e",
    "require('http').createServer((q,s)=>{const t=new URL(q.url,'http://x').searchParams.get('to');t?s.writeHead(302,{location:t}).end():s.end('ok')}).listen(8080)");
  const target = ip(server), name = "victim.example";
  const at = (to) => `http://${name}:8080/?to=${encodeURIComponent(to)}`;
  const forbidden = {
    "database on the Docker network": "http://172.29.83.2:5432/",
    "another container": "http://172.29.83.3:3000/",
    "Docker gateway": "http://172.29.83.1/",
    "link-local metadata": "http://169.254.169.254/latest/meta-data/",
    "carrier-grade metadata": "http://100.100.100.200/",
    "private 10/8": "http://10.0.0.1/",
    "private 192.168/16 host": "http://192.168.65.254/",
    "loopback": "http://127.0.0.1/",
    "IPv6 loopback": "http://[::1]/",
    "another public site by name": "http://one.one.one.one/",
    "another public address": "http://1.1.1.1/",
    "same address, other port": `http://${target}:8081/`,
    "same website under another name": `http://juice-shop:3000/`,
  };
  for (let i = 0; ; i++) {
    if (await zap("core/view/version").catch(() => null)) break;
    assert.ok(i < 60, "ZAP did not start");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.ok((await zapFetch("http://172.29.83.3:3000/")).length >= 1, "ZAP control");
  // Controls: without the guard these are reachable, so a later failure means something.
  assert.equal(guard("status"), "OPEN");
  assert.equal(fetch("http://172.29.83.3:3000/"), "200", "control");
  const open = spawnSync("docker", ["--context", "desktop-linux", "exec", client, "curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "6", "http://1.1.1.1/"], { encoding: "utf8" });
  assert.equal(open.status, 0, "public control");

  const applied = guard("apply", name, "8080", target);
  assert.equal(guard("status"), applied, "status repeats what was applied");
  assert.equal(guard("probe", "8080", target), "VERIFIED");
  assert.equal(fetch(at("")), "200", "authorized target works");
  assert.equal(fetch(at(`http://${name}:8080/`)), "200", "redirect inside the target works");
  for (const [label, url] of Object.entries(forbidden)) {
    assert.equal(fetch(url), "blocked", "direct: " + label);
    assert.equal(fetch(at(url)), "blocked", "redirect: " + label);
    console.log("ok blocked:", label);
  }
  // Rebinding: an attacker's name that now answers with a private address.
  assert.equal(fetch("http://rebind.example:5432/", "--resolve", "rebind.example:5432:172.29.83.2"), "blocked");
  assert.equal(fetch(`http://${name}:8080/`, "--resolve", `${name}:8080:172.29.83.3`), "blocked");
  console.log("ok blocked: rebinding of another name and of the authorized name");
  // The scanner itself cannot change the rules.
  for (const command of [["nft", "flush", "ruleset"], ["ip", "route", "add", "10.0.0.0/8", "via", "172.29.83.1"], ["sh", "-c", "echo 1.2.3.4 x >> /etc/hosts"]])
    assert.notEqual(spawnSync("docker", ["--context", "desktop-linux", "exec", client, ...command]).status, 0);
  // The same through ZAP's own HTTP client, with the API used from this machine while guarded.
  assert.equal((await zap("core/view/version")).version, "2.17.0");
  docker("exec", client, "curl", "-fsS", "--max-time", "4", "-H", "X-ZAP-API-Key: " + key, "http://127.0.0.1:8090/JSON/core/view/version/");
  const body = await zapFetch(at(""));
  assert.ok(body.length >= 1, "ZAP reaches the authorized target");
  assert.ok((await zapFetch(at(`http://${name}:8080/`))).length >= 1, "ZAP reaches the target by redirect");
  for (const [label, url] of Object.entries(forbidden)) {
    const origin = new URL(url).origin;
    assert.deepEqual(await zapFetch(url), [], "ZAP direct: " + label);
    const seen = await zapFetch(at(url));
    assert.ok(seen.every((u) => new URL(u).origin !== origin), "ZAP redirect: " + label);
  }
  console.log("ok real ZAP: every forbidden address blocked, directly and by redirect; API reachable");
  guard("lock");
  assert.equal(fetch(at("")), "blocked", "locked");
  console.log("ok lock blocks the target too");
  for (const bad of [["apply", "a;b", "80", "1.1.1.1"], ["apply", "a", "0", "1.1.1.1"], ["apply", "a", "80", "1.1.1.1;x"], ["apply", "a", "80", "::1"], ["open"]])
    assert.throws(() => guard(...bad));
  console.log("Egress guard verified.");
} catch (error) { console.error(error.stack, "at step", step); process.exitCode = 1; } finally {
  remove();
} })();
