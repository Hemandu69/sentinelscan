import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "../src/lib/errors.ts";
import { browserRenderer, findBrowser, inspectPdf } from "../src/modules/reports/render.ts";
import { filename, registerReports, templateVersion } from "../src/modules/reports/routes.ts";
import { defaultReportDirectory, reportStorage, sha256 } from "../src/modules/reports/storage.ts";

const id = "83ee2301-c70b-4c6b-b66d-b8f275d066f0",
  other = "b113e0b9-c57f-43a4-86a7-51fe94507c96";
const pdf = (label = "one", pages = 2) =>
  Buffer.from(
    "%PDF-1.4\n" + Array.from({ length: pages }, () => "<< /Type /Page /Parent 1 0 R >>\n").join("") + "<< /Type /Pages >>\n% " + label + " " + "x".repeat(1200) + "\n%%EOF\n",
    "latin1",
  );
let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "sentinelscan-reports-"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

type Row = { id: string; assessmentId: string; generatedAt: Date; format: string; templateVersion: string; contentDigest: string; storageKey: string };
function setup(render = vi.fn(async () => pdf())) {
  const rows: Row[] = [];
  const state = { status: { [id]: "COMPLETED", [other]: "COMPLETED" } as Record<string, string>, findings: 2, failCreate: false, analysed: null as Date | null, clock: 0 };
  const db = {
    assessment: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.status[where.id] ? { status: state.status[where.id], _count: { findings: state.findings } } : null,
    },
    report: {
      findMany: async ({ where }: { where: { assessmentId: string } }) =>
        rows.filter((r) => r.assessmentId === where.assessmentId).sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime()),
      findFirst: async ({ where }: { where: { id: string; assessmentId: string } }) =>
        rows.find((r) => r.id === where.id && r.assessmentId === where.assessmentId) ?? null,
      create: async ({ data }: { data: Omit<Row, "generatedAt"> }) => {
        if (state.failCreate) throw new Error("fixture database failure");
        rows.push({ ...data, generatedAt: new Date(1000 + ++state.clock * 1000) });
      },
    },
    $queryRaw: async (parts: TemplateStringsArray) =>
      parts.join("?").includes("to_regclass") ? [{ ready: state.analysed !== null }] : parts.join("?").includes("max(a.analysed_at)") ? [{ at: state.analysed }] : [{ status: state.status[id], findings: state.findings }],
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply
      .code(err instanceof ApiError ? err.status : err instanceof z.ZodError ? 400 : 500)
      .send({ error: err instanceof ApiError ? err.message : err instanceof z.ZodError ? "INVALID_REQUEST" : "INTERNAL_ERROR" }),
  );
  registerReports(app, db as unknown as PrismaClient, reportStorage(directory), render);
  const url = (assessment = id) => `/api/v1/assessments/${assessment}/reports`;
  return {
    app, rows, state, render,
    generate: (assessment = id) => app.inject({ method: "POST", url: url(assessment), payload: {} }),
    list: (assessment = id) => app.inject(url(assessment)),
    download: (which = "latest", assessment = id, q = "") => app.inject(url(assessment) + `/${which}/pdf` + q),
  };
}
test("generates, lists and downloads a real PDF with safe headers and checksum", async () => {
  const f = setup();
  try {
    expect((await f.list()).json()).toEqual({ assessmentId: id, assessmentStatus: "COMPLETED", canGenerate: true, reports: [] });
    const created = await f.generate();
    expect(created.statusCode).toBe(201);
    expect(f.render).toHaveBeenCalledWith({ assessmentId: id, findingCount: 2 });
    expect(created.json().reports).toEqual([
      expect.objectContaining({ available: true, pages: 2, outdated: false, filename: filename(id), contentType: "application/pdf", sha256: sha256(pdf()) }),
    ]);
    expect(created.body).not.toContain(path.basename(directory));
    const file = await f.download();
    expect(file.statusCode).toBe(200);
    expect(file.headers).toMatchObject({
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="sentinelscan-report-${id}.pdf"`,
      "content-length": String(pdf().length),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "x-report-sha256": sha256(pdf()),
    });
    expect(file.rawPayload.equals(pdf())).toBe(true);
    expect(sha256(file.rawPayload)).toBe(f.rows[0].contentDigest);
    expect((await f.download("latest", id, "?view=preview")).headers["content-disposition"]).toMatch(/^inline; /);
    expect((await f.download(f.rows[0].id)).rawPayload.equals(pdf())).toBe(true);
  } finally {
    await f.app.close();
  }
});
test("missing reports, unknown assessments and unfinished assessments are explained", async () => {
  const f = setup();
  try {
    expect((await f.download()).json()).toEqual({ error: "REPORT_NOT_FOUND" });
    for (const call of [f.list, f.generate, (a: string) => f.download("latest", a)]) {
      const response = await call(randomUUID());
      expect([response.statusCode, response.json().error]).toEqual([404, "ASSESSMENT_NOT_FOUND"]);
    }
    for (const status of ["PENDING", "ACTIVE_SCAN_RUNNING", "OUTCOME_UNKNOWN", "FAILED", "CANCELLED", "PROCESSING_RESULTS"]) {
      f.state.status[id] = status;
      expect((await f.list()).json()).toEqual({ assessmentId: id, assessmentStatus: status, canGenerate: false, reports: [] });
      expect((await f.generate()).json().error).toBe("ASSESSMENT_NOT_COMPLETED");
      expect((await f.download()).json().error).toBe("ASSESSMENT_NOT_COMPLETED");
    }
    expect(f.render).not.toHaveBeenCalled();
  } finally {
    await f.app.close();
  }
});
test("a report is reachable only through its own assessment", async () => {
  const f = setup();
  try {
    await f.generate();
    const [row] = f.rows;
    const response = await f.download(row.id, other);
    expect([response.statusCode, response.json().error]).toEqual([404, "REPORT_NOT_FOUND"]);
    expect((await f.download("latest", other)).json().error).toBe("REPORT_NOT_FOUND");
    expect((await f.list(other)).json().reports).toEqual([]);
  } finally {
    await f.app.close();
  }
});
test.each(["..%2f..%2f.env", "..%5c..%5c.env", "%2e%2e%2f.env", "C:%5cWindows%5cwin.ini", "latest.pdf", "latest%00", "a".repeat(400), "%2fetc%2fpasswd"])(
  "path attempt %s is refused",
  async (which) => {
    const f = setup();
    try {
      const response = await f.download(which);
      expect([400, 404, 414]).toContain(response.statusCode);
      expect(response.body).not.toContain(directory);
    } finally {
      await f.app.close();
    }
  },
);
test.each(["../../.env", "..\\..\\.env", "C:\\Windows\\win.ini", "x.pdf", randomUUID() + ".txt", randomUUID() + ".pdf/../x", ""])(
  "a stored name %s never leaves report storage",
  async (key) => {
    await expect(reportStorage(directory).read(key, "0".repeat(64))).rejects.toThrow("REPORT_STORAGE_FAILED");
    const f = setup();
    try {
      f.rows.push({ id: randomUUID(), assessmentId: id, generatedAt: new Date(), format: "application/pdf", templateVersion, contentDigest: "0".repeat(64), storageKey: key });
      const response = await f.download();
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "REPORT_STORAGE_FAILED" });
      expect((await f.list()).json().reports[0].available).toBe(false);
    } finally {
      await f.app.close();
    }
  },
);
test("unknown query values and request bodies are refused", async () => {
  const f = setup();
  try {
    await f.generate();
    expect((await f.download("latest", id, "?view=raw")).statusCode).toBe(400);
    expect((await f.download("latest", id, "?path=../.env")).statusCode).toBe(400);
    expect((await f.app.inject({ method: "POST", url: `/api/v1/assessments/${id}/reports`, payload: { file: "x" } })).statusCode).toBe(400);
  } finally {
    await f.app.close();
  }
});
test("a changed, truncated or missing file is never served", async () => {
  const f = setup();
  try {
    await f.generate();
    const file = path.join(directory, f.rows[0].storageKey);
    await writeFile(file, pdf("two"));
    expect((await f.download()).json().error).toBe("REPORT_CORRUPT");
    expect((await f.list()).json().reports[0]).toMatchObject({ available: false, pages: null });
    await writeFile(file, pdf().subarray(0, 600));
    expect((await f.download()).json().error).toBe("REPORT_CORRUPT");
    await rm(file);
    expect((await f.download()).json().error).toBe("REPORT_FILE_MISSING");
  } finally {
    await f.app.close();
  }
});
test("regeneration keeps the earlier file and serves the newer one", async () => {
  const render = vi.fn(async () => pdf("one"));
  const f = setup(render);
  try {
    await f.generate();
    const first = f.rows[0];
    render.mockResolvedValueOnce(pdf("two", 3));
    const second = (await f.generate()).json();
    expect(second.reports.map((r: { pages: number }) => r.pages)).toEqual([3, 2]);
    expect((await f.download()).rawPayload.equals(pdf("two", 3))).toBe(true);
    expect((await f.download(first.id)).rawPayload.equals(pdf("one"))).toBe(true);
    expect(await readdir(directory)).toHaveLength(2);
  } finally {
    await f.app.close();
  }
});
test.each([
  ["renderer error", async () => { throw new ApiError(502, "REPORT_RENDER_FAILED"); }, "REPORT_RENDER_FAILED"],
  ["missing browser", async () => { throw new ApiError(503, "REPORT_BROWSER_MISSING"); }, "REPORT_BROWSER_MISSING"],
  ["timeout", async () => { throw new ApiError(504, "REPORT_TIMEOUT"); }, "REPORT_TIMEOUT"],
  ["HTML instead of PDF", async () => Buffer.from("<html>" + "x".repeat(2000)), "REPORT_RENDER_FAILED"],
  ["truncated PDF", async () => pdf().subarray(0, 1100), "REPORT_RENDER_FAILED"],
  ["empty output", async () => Buffer.alloc(0), "REPORT_RENDER_FAILED"],
])("failed generation (%s) keeps the valid report", async (_name, failing, code) => {
  const render = vi.fn(async () => pdf());
  const f = setup(render);
  try {
    await f.generate();
    render.mockImplementationOnce(failing as () => Promise<Buffer<ArrayBuffer>>);
    expect((await f.generate()).json().error).toBe(code);
    expect(f.rows).toHaveLength(1);
    expect(await readdir(directory)).toHaveLength(1);
    expect((await f.download()).rawPayload.equals(pdf())).toBe(true);
  } finally {
    await f.app.close();
  }
});
test("a database failure or a change during generation leaves no file behind", async () => {
  const f = setup();
  try {
    f.state.failCreate = true;
    expect((await f.generate()).json().error).toBe("INTERNAL_ERROR");
    f.state.failCreate = false;
    f.render.mockImplementationOnce(async () => {
      f.state.findings = 3;
      return pdf();
    });
    expect((await f.generate()).json().error).toBe("REPORT_CONTENT_MISMATCH");
    expect(await readdir(directory)).toEqual([]);
    expect(f.rows).toEqual([]);
  } finally {
    await f.app.close();
  }
});
test("only one report is generated at a time", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const f = setup(vi.fn(async () => (await gate, pdf())));
  try {
    const first = f.generate();
    await vi.waitFor(() => expect(f.render).toHaveBeenCalled());
    expect((await f.generate()).json().error).toBe("REPORT_BUSY");
    release();
    expect((await first).statusCode).toBe(201);
    expect((await f.generate()).statusCode).toBe(201);
  } finally {
    await f.app.close();
  }
});
test("older templates and later analyses mark a report outdated", async () => {
  const f = setup();
  try {
    await f.generate();
    const outdated = async () => (await f.list()).json().reports[0].outdated;
    expect(await outdated()).toBe(false);
    f.state.analysed = new Date(f.rows[0].generatedAt.getTime() + 1);
    expect(await outdated()).toBe(true);
    f.state.analysed = null;
    f.rows[0].templateVersion = "adopted";
    expect(await outdated()).toBe(true);
  } finally {
    await f.app.close();
  }
});
test("storage never reuses a name and reports an unusable location", async () => {
  const storage = reportStorage(directory);
  const [a, b] = [await storage.write(pdf()), await storage.write(pdf())];
  expect(a.key).not.toBe(b.key);
  expect((await readFile(path.join(directory, a.key))).equals(pdf())).toBe(true);
  await expect(reportStorage(null).write(pdf())).rejects.toThrow("REPORT_STORAGE_FAILED");
  expect(defaultReportDirectory({})).toBeNull();
  const blocked = path.join(directory, "file");
  await writeFile(blocked, "x");
  await expect(reportStorage(blocked).write(pdf())).rejects.toThrow("REPORT_STORAGE_FAILED");
});
test("PDF inspection counts pages and rejects other content", () => {
  expect(inspectPdf(pdf("x", 5))).toMatchObject({ pages: 5 });
  for (const bad of [Buffer.from("<html>" + "x".repeat(2000)), pdf().subarray(0, 1100), Buffer.alloc(5000), pdf("x", 0)])
    expect(inspectPdf(bad)).toBeNull();
});
test("the browser is found only in standard install locations", async () => {
  const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" };
  expect(findBrowser(env, (f) => f.includes("chrome.exe"))).toBe("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  expect(findBrowser(env, (f) => f.includes("(x86)") && f.includes("msedge.exe"))).toBe("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
  expect(findBrowser(env, () => false)).toBeNull();
  await expect(browserRenderer("http://127.0.0.1:3000", () => null)({ assessmentId: id, findingCount: 0 })).rejects.toThrow("REPORT_BROWSER_MISSING");
  await expect(browserRenderer("http://127.0.0.1:3000", () => path.join(directory, "absent.exe"), 3000)({ assessmentId: id, findingCount: 0 })).rejects.toThrow("REPORT_RENDER_FAILED");
});
