/* Fixture-only checks of the built pages. Nothing here contacts Fastify, PostgreSQL or ZAP.
   Build, run `npm.cmd start`, then: node tests/browser/app.mjs <playwright-core> <chrome.exe> */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const [driver, binary] = process.argv.slice(2);
const { chromium } = require(path.resolve(driver));
const web = "http://127.0.0.1:3000",
  api = "http://127.0.0.1:4000";
const site = "7f94fe06-79b4-4522-b4ee-05960ff63b8c",
  id = "d4f1a34b-2e2a-458c-8a1d-37c7c9bc200f",
  findingId = "19cf23db-3901-4c11-be04-cd6b499db65f";
const now = "2026-11-22T08:53:03.274Z",
  demo = "http://juice-shop:3000/",
  session = "a".repeat(64);
const run = (kind, state = "RUNNING", progress = 20) => ({
  kind,
  scan_id: "0",
  session_key: session,
  state,
  progress,
  associated_at: now,
  observed_at: now,
});
const state = {};
function reset(change = {}) {
  Object.assign(state, {
    sites: [{ id: site, displayName: "Fixture " + "long name ".repeat(6), canonicalUrl: demo, createdAt: now }],
    status: "PENDING",
    url: demo,
    runs: [],
    findings: 0,
    fail: {}, // path suffix -> [status, code] or "abort"
    hold: null,
    posts: [],
    ...change,
  });
}
const summary = () => ({
  id,
  targetId: site,
  website: "Fixture",
  targetUrlSnapshot: state.url,
  status: state.status,
  requestedAt: now,
  startedAt: null,
  finishedAt: state.status === "COMPLETED" ? now : null,
  outcomeExplanation:
    state.status === "CANCELLED"
      ? "The operator cancelled tracking in SentinelScan. This did not stop any ZAP scan."
      : null,
  findingCount: state.status === "COMPLETED" ? state.findings : null,
});
function reply(method, url, body) {
  const p = url.pathname;
  if (p === "/health" || p === "/health/database") return { status: "ok" };
  if (p === "/health/zap") return { available: true, version: "2.17.0" };
  if (p === "/api/v1/dashboard")
    return {
      totalChecks: 1,
      completedChecks: state.status === "COMPLETED" ? 1 : 0,
      findingCount: state.status === "COMPLETED" ? state.findings : 0,
      severityCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: state.status === "COMPLETED" ? state.findings : 0, INFO: 0, OTHER: 0 },
    };
  if (p === "/api/v1/targets" && method === "GET") return state.sites;
  if (p === "/api/v1/targets") return { ...state.sites[0], ...body };
  if (p === "/api/v1/targets/" + site)
    return {
      ...state.sites[0],
      confirmation: { token: findingId, wording: "I have permission.", version: "1", url: demo, expiresAt: "2099-01-01T00:00:00Z" },
    };
  if (p === "/api/v1/assessments" && method === "POST")
    return { id, targetId: site, targetUrlSnapshot: demo, status: "PENDING" };
  if (p === "/api/v1/assessments") return { items: [summary()], hasMore: false };
  if (p === "/api/v1/assessments/" + id)
    return {
      ...summary(),
      severities: state.status === "COMPLETED" ? (state.findings ? [{ severity: "LOW", count: state.findings }] : []) : null,
    };
  if (p.endsWith("/execution")) return { status: state.status, runs: state.runs };
  if (p.endsWith("/cancel-tracking")) {
    state.status = "CANCELLED";
    return { status: "CANCELLED", providerScanStopped: false };
  }
  if (p.endsWith("/zap-association")) {
    state.runs.push(run(body.kind));
    return state.runs.at(-1);
  }
  if (p.endsWith("/zap-sync")) return { status: state.status, runs: state.runs };
  if (p === "/api/v1/findings")
    return {
      items: Array.from({ length: state.findings }, () => ({
        id: findingId,
        assessmentId: id,
        website: "Fixture",
        name: "Fixture finding",
        normalizedSeverity: "LOW",
        url: demo + "a".repeat(300),
        confidence: "Low",
        method: "GET",
        parameter: "q",
        firstObservedAt: now,
        description: "Fixture only",
        remediation: null,
        cweId: 79,
        wascId: null,
      })),
      hasMore: false,
    };
  if (p === "/api/v1/integrations/zap/scans")
    return { provider: { endpoint: "http://127.0.0.1:8090", version: "2.17.0" }, runs: [{ id: "0", state: "FINISHED", progress: 100, reportedOrigin: null }] };
  throw Error("No fixture for " + method + " " + p);
}
const browser = await chromium.launch({ executablePath: binary, args: ["--disable-gpu", "--disable-crashpad"] });
const errors = [];
let passed = 0;
async function check(name, options, work) {
  reset(options.state);
  const page = await browser.newPage({ viewport: options.viewport ?? { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(name + ": " + error.message));
  await page.route(api + "/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const cors = { "Access-Control-Allow-Origin": web, "Access-Control-Allow-Headers": "Content-Type" };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (state.hold) await state.hold;
    const body = method === "POST" ? request.postDataJSON() : null;
    if (body) state.posts.push([url.pathname, body]);
    const failure = Object.entries(state.fail).find(([suffix]) => url.pathname.endsWith(suffix))?.[1];
    if (failure === "abort") return route.abort();
    return route
      .fulfill({
        status: failure?.[0] ?? 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify(failure ? { error: failure[1], requestId: "fixture" } : reply(method, url, body)),
      })
      .catch(() => {});
  });
  try {
    await work(page);
    passed++;
    console.log("ok", name);
  } catch (error) {
    errors.push(name + ": " + error.message);
    console.error("FAILED", name, error.message);
  } finally {
    await page.close();
  }
}
// Structural checks available without an accessibility engine. They do not replace an audit.
const audit = (page) =>
  page.evaluate(() => {
    const out = [];
    const visible = (el) => el.getClientRects().length > 0;
    if (!document.documentElement.lang) out.push("missing language");
    if (document.querySelectorAll("main").length !== 1) out.push("main landmark count");
    if (document.querySelectorAll("h1").length !== 1) out.push("h1 count");
    const levels = [...document.querySelectorAll("h1,h2,h3,h4")].filter(visible).map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => {
      if (i && level > levels[i - 1] + 1) out.push("heading jump to h" + level);
    });
    for (const el of document.querySelectorAll("button,a[href]"))
      if (visible(el) && !(el.textContent.trim() || el.getAttribute("aria-label"))) out.push("unnamed " + el.outerHTML.slice(0, 80));
    for (const el of document.querySelectorAll("input,select,textarea")) if (!el.labels?.length) out.push("unlabelled " + el.name);
    for (const el of document.querySelectorAll("img")) if (!el.hasAttribute("alt")) out.push("image without alt");
    const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
    if (new Set(ids).size !== ids.length) out.push("duplicate id");
    // WCAG AA contrast of visible text on opaque ancestors. Artwork is excluded.
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
    const rgba = (value) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const luminance = ([r, g, b]) => {
      const [x, y, z] = [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * x + 0.7152 * y + 0.0722 * z;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (seen.has(el) || !walker.currentNode.data.trim() || !visible(el) || el.closest("script,style,:disabled,[aria-hidden=true]")) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      let back = [255, 255, 255, 255];
      for (let at = el; at; at = at.parentElement) {
        const c = rgba(getComputedStyle(at).backgroundColor);
        if (c[3] === 255) {
          back = c;
          break;
        }
      }
      const pair = [luminance(rgba(style.color)), luminance(back)].sort((a, b) => b - a);
      const ratio = (pair[0] + 0.05) / (pair[1] + 0.05);
      const size = parseFloat(style.fontSize),
        large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) out.push("contrast " + ratio.toFixed(2) + " " + el.textContent.trim().slice(0, 40));
    }
    return out;
  });
const pages = [
  ["/", /The Watchtower/, "Operational"],
  ["/targets/" + site, /Website details/, "Create Security Check"],
  ["/assessments", /^Assessments/, "PENDING"],
  ["/assessments/" + id, /^Assessment details/, "Cancel local tracking"],
  ["/findings", /^Findings/, "Fixture finding"],
  ["/assessments/" + id + "/report", /^Assessment report/, "1 recorded finding"],
];
try {
  for (const [url, title, ready] of pages)
    for (const theme of ["light", "dark"])
      for (const width of [1280, 768, 360])
        await check(
          [url.replace(site, ":id").replace(id, ":id"), theme, width].join(" "),
          {
            viewport: { width, height: 800 },
            state: url.endsWith("report") || url === "/findings" ? { status: "COMPLETED", findings: 1 } : { runs: [run("spider", "FINISHED", 100)] },
          },
          async (page) => {
            await page.addInitScript((t) => localStorage.setItem("watchtower-theme", t), theme);
            await page.goto(web + url);
            await page.getByText(ready).first().waitFor();
            assert.match(await page.title(), title);
            assert.deepEqual(await audit(page), []);
            assert.ok(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              "horizontal overflow",
            );
          },
        );
  for (const url of pages.map(([p]) => p))
    await check("offline state " + url.replace(site, ":id").replace(id, ":id"), {}, async (page) => {
      await page.route(api + "/**", (route) => route.abort());
      await page.goto(web + url);
      if (url === "/") await page.getByText("The website register could not be loaded.").waitFor();
      else await page.getByRole("alert").filter({ hasText: /Could not reach the local API/ }).first().waitFor();
      const text = await page.locator("main").innerText();
      assert.doesNotMatch(text, /\b0 recorded|Your website register is empty|No imported findings|No security checks/);
    });
  await check("loading state precedes data", {}, async (page) => {
    let release;
    state.hold = new Promise((resolve) => (release = resolve));
    await page.goto(web + "/assessments/" + id);
    await page.getByRole("status").filter({ hasText: "Loading records" }).waitFor();
    release();
    await page.getByRole("heading", { name: "Saved scan records" }).waitFor();
  });
  await check("empty states are distinct", { state: { sites: [] } }, async (page) => {
    await page.goto(web + "/");
    await page.getByText("Your website register is empty.").waitFor();
    await page.goto(web + "/findings");
    await page.getByText("No imported findings match this view.").waitFor();
  });
  await check("a check without completion shows unknown results, completed zero shows zero", {}, async (page) => {
    await page.goto(web + "/assessments/" + id);
    await page.getByText("Final results are unavailable for this check.").waitFor();
    state.status = "COMPLETED";
    await page.reload();
    await page.getByText("0 recorded").waitFor();
  });
  await check("consent requires the checkbox and creates one pending check", {}, async (page) => {
    await page.goto(web + "/targets/" + site);
    await page.getByRole("button", { name: "Create Security Check", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Authorize security check" });
    const submit = dialog.getByRole("button", { name: "Create security check" });
    assert.equal(await submit.isDisabled(), true);
    await dialog.getByRole("checkbox").check();
    await submit.click();
    await page.getByText("Security check created · Pending").waitFor();
    assert.deepEqual(state.posts.map(([p, b]) => [p, b.authorized, b.url]), [["/api/v1/assessments", true, demo]]);
  });
  await check("consent dialog closes with Escape without a request", {}, async (page) => {
    await page.goto(web + "/targets/" + site);
    await page.getByRole("button", { name: "Create Security Check", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.deepEqual(state.posts, []);
  });
  await check("registration failure keeps the dialog and explains it", { state: { fail: {} } }, async (page) => {
    await page.goto(web + "/");
    await page.getByText("Operational").first().waitFor();
    state.fail["/targets"] = [422, "DESTINATION_PROHIBITED"];
    await page.getByRole("button", { name: "Add website" }).click();
    await page.getByLabel("Website name").fill("Fixture");
    await page.getByLabel("Website URL").fill("http://127.0.0.1/");
    await page.getByRole("button", { name: "Register website" }).click();
    await page.getByRole("alert").filter({ hasText: "permitted by the local target policy" }).waitFor();
  });
  await check("receipt form never prefills or fetches a fingerprint", {}, async (page) => {
    const requested = [];
    page.on("request", (r) => requested.push(r.url()));
    await page.goto(web + "/assessments/" + id);
    await page.getByText("Record an existing operator run").click();
    await page.getByText("npm.cmd run zap:session").waitFor();
    const key = page.getByLabel("Session fingerprint");
    assert.equal(await key.inputValue(), "");
    await page.getByLabel("Run ID").fill("0");
    await key.fill(session);
    await page.getByRole("button", { name: "Save run receipt" }).click(); // Receipt checkbox unchecked.
    assert.deepEqual(state.posts, []);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Save run receipt" }).click();
    await page.getByText(/Spider · ID 0 · RUNNING/).waitFor();
    assert.deepEqual(state.posts, [
      [
        "/api/v1/assessments/" + id + "/zap-association",
        { kind: "spider", scanId: "0", sessionKey: session, confirmedOperatorReceipt: true, target: demo },
      ],
    ]);
    assert.ok(!requested.some((url) => url.includes("session-fingerprint")));
  });
  await check("failed receipt shows the reason and reloads the saved record", {}, async (page) => {
    await page.goto(web + "/assessments/" + id);
    await page.getByText("Record an existing operator run").click();
    await page.getByLabel("Run ID").fill("0");
    await page.getByLabel("Session fingerprint").fill(session);
    await page.getByRole("checkbox").check();
    state.fail["/zap-association"] = [409, "ZAP_RUN_ALREADY_BOUND"];
    state.runs = [run("spider")];
    await page.getByRole("button", { name: "Save run receipt" }).click();
    await page.getByRole("alert").filter({ hasText: "already has a different binding" }).waitFor();
    await page.getByText(/Spider · ID 0 · RUNNING/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Update saved progress" }).isEnabled(), true);
  });
  await check("ended runs stay unknown and import refusal is explained", {
    state: { status: "ACTIVE_SCAN_RUNNING", runs: [run("spider", "FINISHED", 100), run("active", "FINISHED", 100)], fail: { "/zap-import": [409, "ZAP_SUCCESS_OR_SCOPE_UNVERIFIED"] } },
  }, async (page) => {
    await page.goto(web + "/assessments/" + id);
    await page.getByText("so its outcome is unknown").waitFor();
    await page.getByRole("button", { name: "Verify and import results" }).click();
    await page.getByRole("alert").filter({ hasText: "not supplied sufficient successful completion" }).waitFor();
    await page.getByText("Final results are unavailable for this check.").waitFor();
  });
  await check("an ended run with unknown outcome is not shown as running", { state: { status: "OUTCOME_UNKNOWN", runs: [run("spider", "FINISHED", 100), run("active", "FINISHED", 100)] } }, async (page) => {
    for (const path of ["/assessments", "/assessments/" + id]) {
      await page.goto(web + path);
      await page.getByText(/ENDED · OUTCOME UNKNOWN/).first().waitFor();
      assert.doesNotMatch(await page.locator("main").innerText(), /ACTIVE_SCAN_RUNNING|COMPLETED ·/);
    }
    await page.getByRole("button", { name: "Cancel local tracking" }).waitFor();
  });
  await check("cancellation is confirmed and described as local", {}, async (page) => {
    const prompts = [];
    let accept = false;
    page.on("dialog", (d) => {
      prompts.push(d.message());
      return accept ? d.accept() : d.dismiss();
    });
    await page.goto(web + "/assessments/" + id);
    const cancel = page.getByRole("button", { name: "Cancel local tracking" });
    await cancel.click();
    assert.deepEqual(state.posts, []);
    accept = true;
    await cancel.click();
    await page.getByText("This did not stop any ZAP scan.").waitFor();
    assert.match(prompts[0], /does not stop any ZAP scan/);
    assert.equal(await cancel.count(), 0);
  });
  await check("other websites can cancel tracking but cannot associate runs", { state: { url: "https://example.org/" } }, async (page) => {
    await page.goto(web + "/assessments/" + id);
    await page.getByRole("button", { name: "Cancel local tracking" }).waitFor();
    assert.equal(await page.getByText("Record an existing operator run").count(), 0);
    assert.equal(await page.getByRole("button", { name: /Observe run/ }).count(), 0);
  });
  await check("keyboard reaches the skip link first and focus is visible", {}, async (page) => {
    await page.goto(web + "/");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.className), "skip");
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "none");
  });
  await check("mobile navigation toggles", { viewport: { width: 360, height: 800 } }, async (page) => {
    await page.goto(web + "/");
    const toggle = page.getByRole("button", { name: "Toggle navigation" });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await page.getByRole("link", { name: "Findings" }).waitFor();
  });
  await check("built report page produces a PDF from fixtures in dark theme", { state: { status: "COMPLETED", findings: 1 } }, async (page) => {
    await page.addInitScript(() => localStorage.setItem("watchtower-theme", "dark"));
    await page.goto(web + "/assessments/" + id + "/report");
    await page.getByRole("button", { name: "Print or save PDF" }).waitFor();
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.getByRole("button", { name: "Print or save PDF" }).isVisible(), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("main")).backgroundColor), "rgb(255, 255, 255)");
    assert.equal((await page.pdf({ format: "A4" })).subarray(0, 4).toString(), "%PDF");
  });
} finally {
  await browser.close();
}
console.log("Fixture browser checks passed:", passed, "problems:", errors.length);
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;
