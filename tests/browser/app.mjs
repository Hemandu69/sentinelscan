/* Fixture-only checks of the built pages. Nothing here contacts Fastify, PostgreSQL or ZAP.
   Build, run `npm.cmd start`, then: node tests/browser/app.mjs <playwright-core> <chrome.exe> */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
    ai: false,
    analysed: false,
    guide: false,
    reports: 0,
    damaged: false,
    posts: [],
    files: [],
    tamper: false,
    ready: [],
    scan: null,
    approved: true,
    more: [],
    compare: null,
    stale: false,
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
const reportPdf = Buffer.from("%PDF-1.4\n<< /Type /Page >>\n" + "x".repeat(1200) + "\n%%EOF\n");
const reportHash = createHash("sha256").update(reportPdf).digest("hex");
const reportId = (i) => `00000000-0000-4000-8000-00000000000${i}`;
const reports = () => ({
  assessmentId: id, assessmentStatus: state.status, canGenerate: state.status === "COMPLETED",
  reports: Array.from({ length: state.reports }, (_, i) => ({ id: reportId(state.reports - i), generatedAt: now, filename: `sentinelscan-report-${id}.pdf`, contentType: "application/pdf", sha256: reportHash, available: !state.damaged, size: state.damaged ? null : reportPdf.length, pages: state.damaged ? null : 1, outdated: i > 0 })),
});
const second = "29cf23db-3901-4c11-be04-cd6b499db65f";
function issues() {
  const n = state.status === "COMPLETED" ? state.findings : 0;
  const ids = [findingId, second].slice(0, n);
  const url = (i) => demo + (n === 1 ? "a".repeat(300) : ["assets", "assets/public"][i]);
  const result = state.analysed
    ? { plainTitle: "AI title for different browsers", summary: "AI summary.", whatHappened: "AI what happened.", whyItMatters: "AI why.", technicalExplanation: "AI technical.", potentialImpact: "AI impact.", practicalPriority: "NO_ACTION", priorityReason: "AI reason.", recommendedAction: "AI action.", remediation: [], verificationSteps: ["AI verify."], falsePositiveNotes: "AI notes.", limitations: "AI limits. <img src=x onerror=alert(1)>", evidenceSufficient: false, exampleCode: null }
    : null;
  const list = n
    ? [{
        key: "a".repeat(64), assessmentId: id, targetId: site, website: "Fixture",
        scanner: { title: "Fixture finding", ruleId: "10104", severity: "LOW", sourceSeverity: "Low", confidence: "Low", method: "GET", parameter: "q", evidence: null, description: "Fixture only. Second sentence.", remediation: null, references: ["https://owasp.org/"], cweId: 79, wascId: null },
        guide: state.guide ? { plainTitle: "Guide title", summary: "Guide summary.", whatHappened: "Guide what.", whyItMatters: "Guide why.", nextAction: "Guide action.", verify: ["Guide verify."] } : null,
        findings: ids.map((value, i) => ({ id: value, url: url(i), firstObservedAt: now })),
        endpoints: ids.map((_, i) => url(i)),
        analysis: { status: state.stale ? "STALE" : result ? "COMPLETED" : "NONE", errorCode: null, provider: result ? "anthropic" : null, model: result ? "claude-opus-5-5" : null, analysedAt: result ? now : null, result },
      }]
    : [];
  return { counts: { originalAlerts: n ? 24 : 0, findings: n, issues: list.length, endpoints: n }, severities: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: list.length, INFO: 0, OTHER: 0 }, coverage: { analysed: result ? list.length : 0, unanalysed: result ? 0 : list.length }, issues: list };
}
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
  if (p === "/api/v1/assessments") return { items: [summary(), ...state.more], hasMore: false };
  if (p === "/api/v1/assessments/" + id)
    return {
      ...summary(),
      severities: state.status === "COMPLETED" ? (state.findings ? [{ severity: "LOW", count: state.findings }] : []) : null,
    };
  if (p === "/api/v1/scans/policy")
    return { approvedTargets: state.approved ? [demo] : ["http://other.test/"], configuration: { id: "standard", name: "Standard", details: ["Three threads", "60 alerts per rule"] } };
  if (p === "/api/v1/scans/readiness") return { ready: !state.ready.length, reasons: state.ready };
  if (p === "/api/v1/scans") {
    state.status = "INITIALIZING";
    state.scan = { stage: "SPIDER_RUNNING", spider: { progress: 40, requests: 12, alerts: 3 } };
    return { assessmentId: id };
  }
  if (p.endsWith("/scan/cancel")) {
    state.scan = { ...state.scan, cancelRequested: true };
    return {};
  }
  if (p.endsWith("/scan"))
    return { assessmentId: id, status: state.status, tracked: Boolean(state.scan), stage: null, stageAt: state.scan ? now : null, spider: null, active: null, memoryPercent: state.scan ? 41 : null, peakMemoryPercent: null, cancelRequested: false, code: null, reasons: [], ...state.scan };
  if (p.endsWith("/comparison")) return state.compare;
  if (p.endsWith("/zap-import")) return { status: state.status };
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
  if (p.endsWith("/reports")) {
    if (method === "POST") state.reports++;
    return reports();
  }
  if (p === "/api/v1/analysis/status")
    return { enabled: Boolean(state.ai), reason: state.ai ? null : "AI_DISABLED", provider: state.ai ? "anthropic" : null, model: state.ai ? "claude-opus-5-5" : null, storageReady: true };
  if (p === "/api/v1/issues") return issues();
  if (p.endsWith("/analysis")) {
    state.analysed = true;
    return issues().issues[0];
  }
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
    if (!failure && url.pathname.endsWith("/pdf")) {
      state.files = [...(state.files ?? []), url.pathname + url.search];
      return route.fulfill({ status: 200, headers: { ...cors, "Access-Control-Expose-Headers": "X-Report-Sha256", "Content-Type": "application/pdf", "X-Report-Sha256": reportHash }, body: state.tamper ? Buffer.from("%PDF-changed") : reportPdf }).catch(() => {});
    }
    return route
      .fulfill({
        status: failure?.[0] ?? 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify(failure ? { error: failure[1], requestId: "fixture", ...failure[2] } : reply(method, url, body)),
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
    const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5")].filter(visible).map((h) => Number(h.tagName[1]));
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
  ["/websites", /^Websites/, "Open"],
  ["/targets/" + site, /^Website/, "Latest result"],
  ["/targets/" + site + "/scans", /^Security Scans/, "Compare assessments"],
  ["/targets/" + site + "/analysis", /^AI Analysis/, "Assessment summary"],
  ["/targets/" + site + "/findings", /^Website findings/, "Original alert"],
  ["/targets/" + site + "/reports", /^Reports/, "PDF report available."],
  ["/assessments", /^Assessments/, "Not started"],
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
            state: url.endsWith("report") || url === "/findings" || url.includes("/targets/") ? { status: "COMPLETED", findings: 1, reports: 1 } : { runs: [run("spider", "FINISHED", 100)] },
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
      assert.doesNotMatch(text, /\b0 recorded|Your website register is empty|No imported findings|No assessments yet|No completed assessment|No websites yet|Only informational/);
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
    await page.getByText("No imported findings yet.").waitFor();
  });
  await check("a check without completion shows unknown results, completed zero shows zero", {}, async (page) => {
    await page.goto(web + "/assessments/" + id);
    await page.getByText("Final results are unavailable for this assessment.").waitFor();
    state.status = "COMPLETED";
    await page.reload();
    await page.getByText("0 findings recorded").waitFor();
  });
  await check("an advanced record requires the checkbox and starts nothing", {}, async (page) => {
    await page.goto(web + "/targets/" + site + "/scans");
    await page.getByText("Advanced: record an assessment").click();
    await page.getByRole("button", { name: "Create assessment record" }).click();
    const dialog = page.getByRole("dialog", { name: "Create an assessment record" });
    const submit = dialog.getByRole("button", { name: "Create record" });
    assert.equal(await submit.isDisabled(), true);
    await dialog.getByRole("checkbox").check();
    await submit.click();
    await page.waitForURL("**/assessments/" + id);
    assert.deepEqual(state.posts.map(([p, b]) => [p, b.authorized, b.url]), [["/api/v1/assessments", true, demo]]);
  });
  await check("consent dialog closes with Escape without a request", {}, async (page) => {
    await page.goto(web + "/targets/" + site + "/scans");
    await page.getByText("Advanced: record an assessment").click();
    await page.getByRole("button", { name: "Create assessment record" }).click();
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
    await page.getByText("Final results are unavailable for this assessment.").waitFor();
  });
  await check("an ended run with unknown outcome is not shown as running", { state: { status: "OUTCOME_UNKNOWN", runs: [run("spider", "FINISHED", 100), run("active", "FINISHED", 100)] } }, async (page) => {
    for (const path of ["/assessments", "/assessments/" + id]) {
      await page.goto(web + path);
      await page.getByText(/Ended, outcome unknown/).first().waitFor();
      assert.doesNotMatch(await page.locator("main").innerText(), /ACTIVE_SCAN_RUNNING|testing pages|Completed/);
    }
    await page.getByRole("button", { name: "Cancel local tracking" }).waitFor();
  });
  const at = (section, extra = "") => web + "/targets/" + site + section + extra;
  const textOf = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");
  await check("analysis explains one issue and leaves raw records to Findings", { state: { status: "COMPLETED", findings: 2, guide: true } }, async (page) => {
    await page.goto(at("/analysis"));
    await page.getByRole("heading", { name: "Guide title" }).waitFor();
    const text = await textOf(page);
    assert.match(text, /Original alerts 24 Imported findings 2 Issues 1 Affected locations 2/);
    assert.match(text, /2 affected locations · Not AI analysed/);
    assert.match(text, /0 of 1 analysed, 1 not analysed/);
    assert.match(text, /Not configured/);
    assert.equal(await page.getByRole("button", { name: /Analyse/ }).count(), 0);
    assert.equal(await page.getByText("Technical evidence").count(), 0);
    await page.getByText("Read the explanation").click();
    await page.getByText("SentinelScan guide").first().waitFor();
    assert.equal(await page.getByText("AI interpretation", { exact: true }).count(), 0);
    assert.deepEqual(await audit(page), []);
    await page.getByRole("link", { name: "See the original scanner record" }).click();
    await page.waitForURL("**/findings?assessment=" + id);
    await page.getByRole("heading", { name: "Fixture finding" }).waitFor();
    assert.match(await textOf(page), /Original alert Fixture finding Scanner severity Low/);
    assert.match(await textOf(page), new RegExp(findingId + ".*" + second));
    assert.equal(await page.getByText("Guide title").count(), 0);
    await page.getByRole("link", { name: "Read the explanation in AI Analysis" }).click();
    await page.getByRole("heading", { name: "Guide title" }).waitFor();
  });
  await check("AI analysis runs once, is labelled and never replaces scanner facts", { state: { status: "COMPLETED", findings: 2, ai: true } }, async (page) => {
    await page.goto(at("/analysis"));
    await page.getByText(/sends the sanitized alert/).waitFor();
    assert.deepEqual(state.posts, []);
    await page.getByRole("button", { name: "Analyse with AI" }).click();
    await page.getByRole("heading", { name: "AI title for different browsers" }).waitFor();
    assert.equal(state.posts.length, 1);
    assert.deepEqual(state.posts[0][1], {});
    assert.equal(await page.getByRole("button", { name: /Analyse/ }).count(), 0);
    assert.match(await textOf(page), /Scanner severity Low AI priority No action expected/);
    await page.getByText("Read the explanation").click();
    await page.getByText("This is an opinion, not the scanner's severity.").waitFor();
    assert.match(await textOf(page), /The scanner rates this Low with Low confidence/);
    assert.equal(await page.locator("main img").count(), 0);
    assert.deepEqual(await audit(page), []);
  });
  await check("a failed analysis leaves the issue readable", { state: { status: "COMPLETED", findings: 2, ai: true, guide: true, fail: { "/issues/analysis": [429, "AI_RATE_LIMITED"], ["/" + "a".repeat(64) + "/analysis"]: [429, "AI_RATE_LIMITED"] } } }, async (page) => {
    await page.goto(at("/analysis"));
    await page.getByRole("button", { name: "Analyse with AI" }).click();
    await page.getByRole("alert").filter({ hasText: "limiting requests" }).waitFor();
    await page.getByRole("heading", { name: "Guide title" }).waitFor();
  });
  await check("an outdated analysis is marked and can be updated", { state: { status: "COMPLETED", findings: 2, ai: true, stale: true } }, async (page) => {
    await page.goto(at("/analysis"));
    await page.getByText(/AI analysis is outdated/).waitFor();
    await page.getByRole("button", { name: "Update AI analysis" }).waitFor();
  });
  await check("tabs and breadcrumb work by keyboard and keep the chosen assessment", { state: { status: "COMPLETED", findings: 2, reports: 1 } }, async (page) => {
    await page.goto(at("/analysis", "?assessment=" + id));
    const tabs = page.getByRole("navigation", { name: "Website sections" });
    assert.deepEqual(await tabs.getByRole("link").allInnerTexts(), ["Overview", "Security Scans", "AI Analysis", "Findings", "Reports"]);
    assert.equal(await tabs.locator("[aria-current=page]").innerText(), "AI Analysis");
    await tabs.getByRole("link", { name: "Reports" }).focus();
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "none");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/reports?assessment=" + id);
    await page.getByText("PDF report available.").waitFor();
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Websites" }).click();
    await page.getByRole("heading", { name: "Websites", exact: true }).waitFor();
  });
  await check("an unknown assessment is refused instead of showing another one", { state: { status: "COMPLETED", findings: 2 } }, async (page) => {
    await page.goto(at("/analysis", "?assessment=" + second));
    await page.getByText("does not belong to this website").waitFor();
    assert.equal(await page.getByRole("heading", { name: "Fixture finding" }).count(), 0);
  });
  await check("a website without a completed assessment explains its empty sections", {}, async (page) => {
    for (const section of ["/analysis", "/findings", "/reports"]) {
      await page.goto(at(section));
      await page.getByText("No completed assessment yet.").waitFor();
    }
  });
  await check("a scan needs consent, starts once and shows measured progress only", {}, async (page) => {
    await page.goto(at(""));
    await page.getByRole("button", { name: "Start New Security Scan" }).click();
    const dialog = page.getByRole("dialog", { name: "Start New Security Scan" });
    const go = dialog.getByRole("button", { name: "Start scan" });
    await go.waitFor();
    assert.equal(await go.isDisabled(), true);
    assert.match(await dialog.innerText(), /http:\/\/juice-shop:3000\/[\s\S]*60 alerts per rule/);
    assert.equal(await dialog.getByRole("textbox").count(), 0);
    assert.deepEqual(await audit(page), []);
    await dialog.getByRole("checkbox").check();
    await go.dblclick();
    await page.waitForURL("**/scans?assessment=" + id);
    await page.getByText("40% reported by the scanner").waitFor();
    assert.equal(state.posts.length, 1);
    const [path, sent] = state.posts[0];
    assert.equal(path, "/api/v1/scans");
    assert.deepEqual(Object.keys(sent).sort(), ["authorizationTextVersion", "authorized", "configuration", "confirmationToken", "requestKey", "targetId", "url"]);
    assert.deepEqual(await audit(page), []);
    state.scan = { stage: "COLLECTING_EVIDENCE" };
    await page.getByText("Exact progress is not available for this step.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Stop scan" }).count(), 0);
    assert.equal(await page.locator("progress").count(), 0);
    state.scan = { stage: "COMPLETED" };
    state.status = "COMPLETED";
    state.findings = 2;
    await page.getByText("results were verified and imported").waitFor();
    await page.locator(".history").getByRole("link", { name: "AI Analysis" }).waitFor();
  });
  await check("a scanner that is not ready blocks the start with reasons", { state: { ready: ["MEMORY_TOO_HIGH", "UNRESOLVED_SCAN_IN_SESSION"] } }, async (page) => {
    await page.goto(at("/scans"));
    await page.getByRole("button", { name: "Start New Security Scan" }).click();
    await page.getByText("using too much memory").waitFor();
    await page.getByText("has not been resolved").waitFor();
    assert.equal(await page.getByRole("button", { name: "Start scan" }).count(), 0);
    state.ready = [];
    await page.getByRole("button", { name: "Check again" }).click();
    await page.getByRole("button", { name: "Start scan" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.deepEqual(state.posts, []);
  });
  await check("a refusal at start time is shown with its reasons", { state: { fail: { "/api/v1/scans": [409, "SCAN_NOT_READY", { reasons: ["SERVICE_UNHEALTHY"] }] } } }, async (page) => {
    await page.goto(at("/scans"));
    await page.getByRole("button", { name: "Start New Security Scan" }).click();
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start scan" }).click();
    await page.getByText("is not healthy").waitFor();
  });
  await check("a lost answer never repeats the start", { state: { fail: { "/api/v1/scans": "abort" } } }, async (page) => {
    await page.goto(at("/scans"));
    await page.getByRole("button", { name: "Start New Security Scan" }).click();
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start scan" }).click();
    await page.getByRole("alert").filter({ hasText: "may have started" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Start scan" }).isDisabled(), true);
    assert.equal(state.posts.length, 1);
  });
  await check("stopping a scan is confirmed first", { state: { status: "ACTIVE_SCAN_RUNNING", scan: { stage: "ACTIVE_RUNNING", active: { progress: 55, requests: 900, alerts: 6 } } } }, async (page) => {
    await page.goto(at("/scans"));
    await page.getByRole("button", { name: "Stop scan" }).click();
    assert.deepEqual(state.posts, []);
    await page.getByRole("button", { name: "Keep scanning" }).click();
    await page.getByRole("button", { name: "Stop scan" }).click();
    await page.getByRole("button", { name: "Stop the scan" }).click();
    await page.getByText("A stop was requested").waitFor();
    assert.deepEqual(state.posts, [["/api/v1/assessments/" + id + "/scan/cancel", { confirmed: true }]]);
    state.scan = { stage: "CANCELLED" };
    state.status = "CANCELLED";
    await page.getByText("The scan was stopped. No results were imported.").waitFor();
  });
  await check("an interrupted scan offers only a checked outcome", { state: { status: "ACTIVE_SCAN_RUNNING", fail: { "/zap-import": [409, "ZAP_SUCCESS_OR_SCOPE_UNVERIFIED"] } } }, async (page) => {
    await page.goto(at("/scans"));
    await page.getByText("not following a scan").waitFor();
    assert.equal(await page.getByRole("button", { name: "Stop scan" }).count(), 0);
    await page.getByRole("button", { name: "Check outcome" }).click();
    await page.getByRole("alert").filter({ hasText: "sufficient successful completion" }).waitFor();
    assert.deepEqual(state.posts.map(([p]) => p.split("/").pop()), ["zap-sync", "zap-import"]);
  });
  await check("progress recovers after the API is unreachable", { state: { status: "ACTIVE_SCAN_RUNNING", scan: { stage: "ACTIVE_RUNNING", active: { progress: 10, requests: 1, alerts: 0 } } } }, async (page) => {
    await page.goto(at("/scans"));
    await page.getByText("10% reported").waitFor();
    state.fail["/scan"] = "abort";
    await page.getByRole("alert").filter({ hasText: "Progress could not be read" }).waitFor();
    state.fail = {};
    state.scan.active.progress = 30;
    await page.getByText("30% reported").waitFor({ timeout: 9000 });
  });
  await check("a website outside the approved list cannot be scanned", { state: { approved: false } }, async (page) => {
    for (const section of ["", "/scans"]) {
      await page.goto(at(section));
      await page.getByText("Scanning is not available for this website.").waitFor();
      assert.equal(await page.getByRole("button", { name: "Start New Security Scan" }).count(), 0);
    }
  });
  const earlier = { id: second, targetId: site, website: "Fixture", targetUrlSnapshot: demo, status: "COMPLETED", requestedAt: "2026-11-20T08:00:00.000Z", startedAt: null, finishedAt: "2026-11-20T08:06:00.000Z", outcomeExplanation: null, findingCount: 1 };
  const refs = { earlier: { id: second, finishedAt: earlier.finishedAt, findings: 1 }, later: { id, finishedAt: now, findings: 2 } };
  await check("comparison never claims a resolved finding", { state: { status: "COMPLETED", findings: 2, more: [earlier], compare: { ...refs, comparable: true, reasons: [], result: { new: [{ id: findingId, name: "New thing", url: demo, severity: "LOW" }], persistent: [], changed: [], notSeenAgain: [{ id: second, name: "Old thing", url: demo, severity: "INFO" }], resolved: [], resolvedSupported: false } } } }, async (page) => {
    await page.goto(at("/scans"));
    await page.getByText("Not seen again (1)").waitFor();
    const text = await textOf(page);
    assert.match(text, /New \(1\)/);
    assert.match(text, /does not show that it was fixed/);
    assert.match(text, /Resolved findings are not listed/);
    assert.deepEqual(await audit(page), []);
    await page.getByLabel("Earlier assessment").selectOption(id);
    await page.getByText("Choose two different assessments.").waitFor();
  });
  await check("assessments that cannot be compared say why", { state: { status: "COMPLETED", findings: 2, more: [earlier], compare: { ...refs, comparable: false, reasons: ["EVIDENCE_MISSING"], result: null } } }, async (page) => {
    await page.goto(at("/scans"));
    await page.getByText("has no verified run evidence").waitFor();
  });
  await check("no page requests ZAP or a session fingerprint", { state: { status: "COMPLETED", findings: 2 } }, async (page) => {
    const requested = [];
    page.on("request", (r) => requested.push(r.url()));
    for (const section of ["", "/scans", "/analysis", "/findings", "/reports"]) {
      await page.goto(at(section));
      await page.getByRole("navigation", { name: "Website sections" }).waitFor();
      await page.waitForLoadState("networkidle");
    }
    assert.ok(requested.every((url) => /^(http:\/\/127\.0\.0\.1:[34]000\/|data:|blob:)/.test(url) && !/fingerprint|apikey/i.test(url)));
  });
  await check("finding search and severity filters", { state: { status: "COMPLETED", findings: 2 } }, async (page) => {
    await page.goto(web + "/findings");
    await page.getByRole("heading", { name: "Fixture finding" }).waitFor();
    await page.getByLabel("Search findings").fill("public");
    await page.getByRole("heading", { name: "Fixture finding" }).waitFor();
    await page.getByRole("combobox").selectOption("HIGH");
    await page.getByText("No findings match this view.").waitFor();
  });
  await check("assessment summary explains results without a score", { state: { status: "COMPLETED", findings: 2, guide: true } }, async (page) => {
    await page.goto(web + "/assessments/" + id);
    await page.getByText("1 issue needs attention.").waitFor();
    const text = (await page.locator(".assessment-summary").innerText()).replace(/\s+/g, " ");
    assert.match(text, /does not show that the website is secure/);
    assert.match(text, /40026/);
    assert.match(text, /not full OWASP coverage/);
    assert.doesNotMatch(text, /score|grade|\d+\s*%/i);
  });
  await check("report with AI marks its text", { state: { status: "COMPLETED", findings: 1, analysed: true } }, async (page) => {
    await page.goto(web + "/assessments/" + id + "/report");
    await page.getByText("What happened · AI interpretation").waitFor();
    await page.getByText("AI text is marked, may be wrong").waitFor();
    assert.match(await page.locator("main").innerText(), /Scanner severity Low · Low confidence · AI priority No action expected \(opinion\)/);
  });
  await check("report without AI stays complete and unmarked", { state: { status: "COMPLETED", findings: 1 } }, async (page) => {
    await page.goto(web + "/assessments/" + id + "/report");
    await page.getByText("0 of 1 issue has an AI interpretation").waitFor();
    assert.doesNotMatch(await page.locator("article").innerText(), /AI interpretation/);
  });
  for (const [theme, width] of [["light", 1280], ["dark", 360]])
    await check(`report is generated, previewed and downloaded (${theme} ${width})`, { state: { status: "COMPLETED", findings: 2 }, viewport: { width, height: 800 } }, async (page) => {
      await page.addInitScript((t) => localStorage.setItem("watchtower-theme", t), theme);
      await page.goto(web + "/assessments/" + id);
      await page.getByText("No PDF report has been generated yet.").waitFor();
      assert.equal(await page.getByRole("button", { name: "Download PDF Report" }).count(), 0);
      await page.getByRole("button", { name: "Generate Report", exact: true }).click();
      await page.getByText("PDF report available.").waitFor();
      await page.getByText(/Last generated .* · 1 page · 2 KB/).waitFor();
      const waiting = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download PDF Report" }).click();
      const download = await waiting;
      assert.equal(download.suggestedFilename(), `sentinelscan-report-${id}.pdf`);
      assert.deepEqual(readFileSync(await download.path()), reportPdf);
      await page.getByText("Download started:").waitFor();
      await page.getByRole("button", { name: "Preview Report" }).click();
      await page.getByTitle(/Report generated/).waitFor({ state: "attached" });
      assert.deepEqual(state.files, [`/api/v1/assessments/${id}/reports/${reportId(1)}/pdf`, `/api/v1/assessments/${id}/reports/${reportId(1)}/pdf?view=preview`]);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole("button", { name: "Close preview" }).click();
      assert.deepEqual(await audit(page), []);
      await page.getByRole("button", { name: "Regenerate Report" }).click();
      await page.getByText("Earlier reports (1)").waitFor();
      assert.equal(state.posts.length, 2);
      assert.ok(state.posts.every(([p, body]) => p === `/api/v1/assessments/${id}/reports` && Object.keys(body).length === 0));
    });
  await check("report actions show progress and ignore repeated clicks", { state: { status: "COMPLETED", findings: 2 } }, async (page) => {
    await page.goto(web + "/assessments/" + id);
    const button = page.getByRole("button", { name: "Generate Report", exact: true });
    await button.waitFor();
    let release;
    state.hold = new Promise((resolve) => (release = resolve));
    await button.dblclick();
    await page.getByText("This can take up to a minute").waitFor();
    assert.equal(await page.getByRole("button", { name: "Generating…" }).isDisabled(), true);
    release();
    await page.getByText("PDF report available.").waitFor();
    assert.equal(state.posts.length, 1);
  });
  await check("report failures are explained and keep the earlier report", { state: { status: "COMPLETED", findings: 2, reports: 1, fail: {} } }, async (page) => {
    await page.goto(web + "/assessments/" + id);
    await page.getByText("PDF report available.").waitFor();
    state.fail["/reports"] = [502, "REPORT_PAGE_REFUSED"];
    await page.getByRole("button", { name: "Regenerate Report" }).click();
    await page.getByRole("alert").filter({ hasText: "no PDF was created" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Download PDF Report" }).isEnabled(), true);
    state.fail = {};
    state.tamper = true;
    await page.getByRole("button", { name: "Download PDF Report" }).click();
    await page.getByRole("alert").filter({ hasText: "checksum" }).waitFor();
    assert.equal(await page.getByText("Download started").count(), 0);
  });
  await check("a damaged report offers generation only", { state: { status: "COMPLETED", findings: 2, reports: 1, damaged: true } }, async (page) => {
    await page.goto(web + "/assessments/" + id);
    await page.getByText("missing or damaged").waitFor();
    assert.equal(await page.getByRole("button", { name: "Download PDF Report" }).count(), 0);
    await page.getByRole("button", { name: "Generate Report", exact: true }).waitFor();
  });
  for (const [status, reason] of [["PENDING", /once the assessment is completed/], ["OUTCOME_UNKNOWN", /outcome is not verified/], ["CANCELLED", /Tracking was cancelled/]])
    await check("no report controls for " + status, { state: { status, reports: 1 } }, async (page) => {
      await page.goto(web + "/assessments/" + id);
      await page.getByText(reason).waitFor();
      for (const name of ["Download PDF Report", "Preview Report", "Generate Report", "Regenerate Report"])
        assert.equal(await page.getByRole("button", { name }).count(), 0);
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
    await page.getByRole("link", { name: "Findings", exact: true }).waitFor();
  });
  await check("built report page produces a PDF from fixtures in dark theme", { state: { status: "COMPLETED", findings: 1 } }, async (page) => {
    await page.addInitScript(() => localStorage.setItem("watchtower-theme", "dark"));
    await page.goto(web + "/assessments/" + id + "/report");
    await page.getByRole("button", { name: "Print / Save as PDF" }).waitFor();
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.getByRole("button", { name: "Print / Save as PDF" }).isVisible(), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("main")).backgroundColor), "rgb(255, 255, 255)");
    assert.equal((await page.pdf({ format: "A4" })).subarray(0, 4).toString(), "%PDF");
  });
} finally {
  await browser.close();
}
console.log("Fixture browser checks passed:", passed, "problems:", errors.length);
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;
