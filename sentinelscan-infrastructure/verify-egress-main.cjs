// Proves the outbound firewall inside the real ZAP container's network, as ZAP's own user.
// Starts no scan and adds nothing to the ZAP session. Ends with every destination locked.
"use strict";
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const zap = "sentinelscan-infrastructure-zap-1",
  server = "sentinelscan-egress-check-server",
  network = "sentinelscan-infrastructure_local";
const host = "juice-shop",
  port = "3000";
function run(...args) {
  const result = spawnSync("docker", ["--context", "desktop-linux", ...args], { encoding: "utf8", timeout: 120000 });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}
function docker(...args) {
  const result = run(...args);
  if (!result.ok) throw Error(args.slice(0, 2).join(" ") + ": " + result.err);
  return result.out;
}
const guard = (...args) =>
  docker("run", "--rm", "--pull", "never", "--network", "container:" + zap, "--cap-drop", "ALL", "--cap-add", "NET_ADMIN",
    "--security-opt", "no-new-privileges", "--tmpfs", "/tmp", "sentinelscan-egress-guard:1", ...args);
// Packets that the kernel rules refused so far. A timeout alone would prove nothing.
const denied = () => Number(/packets (\d+)/.exec(docker("run", "--rm", "--pull", "never", "--network", "container:" + zap, "--cap-drop", "ALL",
  "--cap-add", "NET_ADMIN", "--entrypoint", "nft", "sentinelscan-egress-guard:1", "list", "counter", "inet", "sentinelscan", "denied"))[1]);
// "200" means an answer arrived. "blocked: n" means no connection, with curl's reason.
function request(url, ...extra) {
  const before = denied();
  const result = run("exec", zap, "curl", "-sS", "-L", "-o", "/dev/null", "-w", "%{http_code} %{remote_ip}", "--max-time", "4", ...extra, url);
  return result.ok ? result.out : `blocked, ${denied() - before} packets refused by the rules; ` + result.err.split("\n").pop().slice(0, 34);
}
const api = (view) => docker("exec", zap, "sh", "-c", `curl -fsS -m 8 -H @/dev/shm/zap-key.header http://127.0.0.1:8090/JSON/${view}/`);
const state = () => [api("core/view/sessionLocation"), api("core/view/numberOfMessages"), api("spider/view/scans"), api("ascan/view/scans"),
  docker("inspect", "--format", "{{.Id}} {{.State.StartedAt}}", zap)].join("\n");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
function expect(label, outcome, want) {
  const good = want === "blocked" ? /^blocked(, [1-9]|$)/.test(outcome) || (label.includes("no IPv6 route") && outcome.startsWith("blocked")) : outcome.startsWith(want);
  if (!good) failures++;
  console.log(good ? "PASS" : "FAIL", label.padEnd(58), outcome);
}
(async () => {
  const before = state();
  assert.ok(!/"(RUNNING|PAUSED)"/.test(before), "a scan is running");
  console.log("initial state:", guard("status").split("\n")[0]);
  try {
    run("rm", "-f", server);
    docker("run", "-d", "--name", server, "--network", network, "--entrypoint", "/nodejs/bin/node", "bkimminich/juice-shop:latest", "-e",
      "require('http').createServer((q,s)=>{const t=new URL(q.url,'http://x').searchParams.get('to');t?s.writeHead(302,{location:t}).end():s.end('ok')}).listen(8080)");
    const own = docker("inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", server);
    const address = docker("inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", "sentinelscan-infrastructure-juice-shop-1");
    const authorized = `http://${host}:${port}/`;
    const forbidden = [
      ["unauthorized public domain", "https://example.com/"],
      ["unauthorized public address", "https://1.1.1.1/"],
      ["loopback", "http://127.0.0.1/"],
      ["loopback by name", "http://localhost/"],
      ["private IPv4 10/8", "http://10.0.0.1/"],
      ["private IPv4 172.16/12", "http://172.16.0.1/"],
      ["private IPv4 192.168/16", "http://192.168.65.254/"],
      ["private IPv6 (no IPv6 route)", "http://[fd00::1]/"],
      ["IPv6 loopback", "http://[::1]:8090/"],
      ["IPv6 link-local (no IPv6 route)", "http://[fe80::1]/"],
      ["public IPv6 (no IPv6 route)", "https://[2606:4700:4700::1111]/"],
      ["link-local", "http://169.254.1.1/"],
      ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
      ["cloud metadata by name", "http://metadata.google.internal/"],
      ["carrier-grade and Alibaba metadata", "http://100.100.100.200/"],
      ["Azure platform address", "http://168.63.129.16/"],
      ["reserved", "http://240.0.0.1/"],
      ["Docker gateway", "http://172.29.83.1/"],
      ["Docker gateway, database port", "http://172.29.83.1:5432/"],
      ["database container", "http://172.29.83.2:5432/"],
      ["database by name", "http://postgres:5432/"],
      ["Docker host name", "http://host.docker.internal:4000/"],
    ];

    console.log("\n== Authorized demo", authorized, address);
    const rules = guard("apply", host, port, address);
    expect("firewall self-proof", guard("probe", port, address), "VERIFIED");
    expect("authorized website", request(authorized), "200");
    expect("other port on the authorized address", request(`http://${address}:3001/`), "blocked");
    for (const [label, url] of forbidden) expect(label, request(url), "blocked");
    expect("rebinding: other name to the database", request("http://rebind.example:5432/", "--resolve", "rebind.example:5432:172.29.83.2"), "blocked");
    expect("rebinding: authorized name to the database", request(`http://${host}:5432/`, "--resolve", `${host}:5432:172.29.83.2`), "blocked");
    expect("rebinding: authorized name and port to metadata", request(authorized, "--resolve", `${host}:${port}:169.254.169.254`), "blocked");
    expect("rebinding: authorized name and port to a public address", request(authorized, "--resolve", `${host}:${port}:1.1.1.1`), "blocked");
    for (const [label, ...command] of [["change routes", "ip", "route"], ["edit hosts", "sh", "-c", "echo x >> /etc/hosts"], ["write to the kernel network settings", "sh", "-c", "echo 1 > /proc/sys/net/ipv4/ip_forward"]])
      expect("ZAP user cannot " + label, run("exec", zap, ...command).ok ? "done" : "blocked", "blocked");

    console.log("\n== Stays in force, checked every 10 seconds for a minute");
    for (let i = 1; i <= 6; i++) {
      await pause(10000);
      const held = guard("status") === rules;
      const sample = [request("http://172.29.83.2:5432/"), request("https://1.1.1.1/"), request("http://169.254.169.254/")];
      expect(`recheck ${i}: rules identical, 3 destinations refused`, held && sample.every((s) => s.startsWith("blocked")) ? "held" : "changed", "held");
    }
    expect("authorized website still reachable", request(authorized), "200");
    expect("ZAP answers the API over its published port", (await fetch("http://127.0.0.1:8090/").catch(() => null)) ? "answers" : "silent", "answers");
    expect("ZAP container health", docker("inspect", "--format", "{{.State.Health.Status}}", zap), "healthy");

    console.log("\n== Redirects, from a hostile website that is itself allowed");
    guard("apply", "redirect.example", "8080", own);
    const from = (url) => "http://redirect.example:8080/?to=" + encodeURIComponent(url);
    expect("control: allowed website answers", request(from("")), "200");
    expect("control: redirect within the same origin", request(from("http://redirect.example:8080/")), "200");
    for (const [label, url] of forbidden) expect("redirect to " + label, request(from(url)), "blocked");
    expect("redirect to same address, other port", request(from(`http://${own}:8081/`)), "blocked");
    expect("redirect to the previously authorized website", request(from(authorized)), "blocked");
  } finally {
    run("rm", "-f", server);
    const locked = guard("lock");
    console.log("\n== Locked");
    expect("authorized website refused once locked", request(`http://172.29.83.3:${port}/`), "blocked");
    expect("database refused once locked", request("http://172.29.83.2:5432/"), "blocked");
    expect("lock rules in place", guard("status") === locked ? "held" : "changed", "held");
  }
  expect("session, history, scans and container unchanged", state() === before ? "same" : "changed", "same");
  console.log(failures ? failures + " FAILED" : "All checks passed.");
  if (failures) process.exitCode = 1;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
