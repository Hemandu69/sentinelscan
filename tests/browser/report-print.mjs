/* Fixture-only print check. CLI arguments identify esbuild, Playwright and Chrome. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
const [bundler, driver, binary] = process.argv.slice(2);
const { build } = require(path.resolve(bundler));
const { chromium } = require(path.resolve(driver));
const id = randomUUID(),
  now = new Date().toISOString();
const entry =
  'import { createRoot } from "react-dom/client"; import { AssessmentReport } from "./components/assessment-report"; createRoot(document.getElementById("root")).render(<AssessmentReport id="' +
  id +
  '"/>);';
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: process.cwd() },
  jsx: "automatic",
  bundle: true,
  write: false,
  outdir: "fixture",
  define: {
    "process.env": "{}",
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_API_BASE_URL": '""',
  },
});
const browser = await chromium.launch({
  executablePath: binary,
  args: ["--disable-gpu", "--disable-crashpad"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => console.error(e.message));
  let fail = false;
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/print-fixture")
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    if (url.origin !== "http://127.0.0.1:4000") return route.abort();
    const body = url.pathname.endsWith(id)
      ? {
          id,
          website: "Print fixture",
          targetUrlSnapshot: "http://fixture.invalid/",
          status: "COMPLETED",
          requestedAt: now,
          startedAt: null,
          finishedAt: now,
          findingCount: 1,
          severities: [{ severity: "LOW", count: 1 }],
        }
      : {
          items: [
            {
              id: randomUUID(),
              assessmentId: id,
              website: "Print fixture",
              name: "<script>fixture()</script>",
              normalizedSeverity: "LOW",
              url: "http://fixture.invalid/" + "a".repeat(1600),
              confidence: "HIGH",
              firstObservedAt: now,
              description: "Fixture only",
              remediation:
                "Long remediation text. ".repeat(1400) + "End of remediation.",
              cweId: null,
              wascId: null,
            },
          ],
          hasMore: false,
        };
    return route.fulfill({
      status: fail && url.pathname.endsWith("findings") ? 503 : 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  });
  async function render() {
    await page.goto("http://127.0.0.1:4000/print-fixture");
    for (const f of bundle.outputFiles)
      if (f.path.endsWith(".css")) await page.addStyleTag({ content: f.text });
      else if (f.path.endsWith(".js"))
        await page.addScriptTag({ content: f.text });
  }
  await render();
  const print = page.getByRole("button", { name: "Print or save PDF" });
  await print.waitFor();
  assert.equal(
    await page.locator("article h3").textContent(),
    "<script>fixture()</script>",
  );
  assert.equal(await page.locator("article script").count(), 0);
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator("nav").isVisible(), false);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const pdf = await page.pdf({ format: "A4" });
  const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  assert.ok(pages > 1, "Expected long report to span multiple PDF pages");
  await page.emulateMedia({ media: "screen" });
  fail = true;
  await render();
  await page.getByRole("alert").waitFor();
  assert.equal(await print.count(), 0);
  fail = false;
  await render();
  await print.waitFor();
  await page.evaluate(() =>
    window.addEventListener("beforeprint", () => {
      document.body.dataset.printed = "yes";
    }),
  );
  await print.click();
  assert.equal(await page.locator("body").getAttribute("data-printed"), "yes");
  console.log("Fixture Chrome print check passed; PDF pages:", pages);
} finally {
  await browser.close();
}
