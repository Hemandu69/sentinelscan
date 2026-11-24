import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { ApiError } from "../../lib/errors.ts";

export type RenderRequest = { assessmentId: string; findingCount: number };
export type Render = (request: RenderRequest) => Promise<Buffer>;

export function findBrowser(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
) {
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA];
  for (const product of ["Google\\Chrome\\Application\\chrome.exe", "Microsoft\\Edge\\Application\\msedge.exe"])
    for (const root of roots) {
      const file = root && path.win32.join(root, product);
      if (file && exists(file)) return file;
    }
  return null;
}

type Reply = { id?: number; result?: Record<string, unknown>; error?: { message: string } };
// The browser's own automation protocol over private pipes. No port is opened.
function connection(input: Writable, output: Readable) {
  let next = 0,
    buffer = Buffer.alloc(0);
  const waiting = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  output.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (let end = buffer.indexOf(0); end >= 0; end = buffer.indexOf(0)) {
      const reply = JSON.parse(buffer.subarray(0, end).toString("utf8")) as Reply;
      buffer = buffer.subarray(end + 1);
      const item = reply.id === undefined ? undefined : waiting.get(reply.id);
      if (!item) continue;
      waiting.delete(reply.id!);
      if (reply.error) item.reject(new Error("browser command failed"));
      else item.resolve(reply.result ?? {});
    }
  });
  const stop = () => {
    for (const item of waiting.values()) item.reject(new Error("browser closed"));
    waiting.clear();
  };
  output.on("close", stop);
  output.on("error", stop);
  input.on("error", stop);
  return (method: string, params: object = {}, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      input.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
}
// Renders only the application's own report page. The address is fixed by configuration.
export function browserRenderer(webOrigin: string, browser = findBrowser, timeoutMs = 60000): Render {
  return async ({ assessmentId, findingCount }) => {
    const binary = browser();
    if (!binary) throw new ApiError(503, "REPORT_BROWSER_MISSING");
    const profile = await mkdtemp(path.join(tmpdir(), "sentinelscan-report-"));
    const child = spawn(
      binary,
      [
        "--headless=new",
        "--remote-debugging-pipe",
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-gpu",
        // The page may reach only this machine.
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true },
    );
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    try {
      const send = connection(child.stdio[3] as Writable, child.stdio[4] as Readable);
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const session = String(sessionId);
      const navigated = await send("Page.navigate", { url: `${webOrigin}/assessments/${assessmentId}/report` }, session);
      if (navigated.errorText) throw new ApiError(503, "REPORT_PAGE_UNAVAILABLE");
      // The page marks itself only after every record was loaded and reconciled.
      const expression = `(() => { const main = document.querySelector("main"); if (!main) return "wait"; if (main.querySelector("[role=alert]")) return "refused"; return main.dataset.assessmentId ? JSON.stringify({ id: main.dataset.assessmentId, findings: main.dataset.findings }) : "wait"; })()`;
      for (;;) {
        const { result } = await send("Runtime.evaluate", { expression, returnByValue: true }, session);
        const value = (result as { value?: string } | undefined)?.value;
        if (value === "refused") throw new ApiError(502, "REPORT_PAGE_REFUSED");
        if (value && value !== "wait") {
          const shown = JSON.parse(value) as { id: string; findings: string };
          if (shown.id !== assessmentId || shown.findings !== String(findingCount))
            throw new ApiError(502, "REPORT_CONTENT_MISMATCH");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true }, session);
      const { data } = await send(
        "Page.printToPDF",
        {
          printBackground: true,
          paperWidth: 8.27,
          paperHeight: 11.69,
          marginTop: 0.6,
          marginBottom: 0.7,
          marginLeft: 0.6,
          marginRight: 0.6,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#555">Assessment ${assessmentId} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
        },
        session,
      );
      return Buffer.from(String(data), "base64");
    } catch (error) {
      if (timedOut) throw new ApiError(504, "REPORT_TIMEOUT");
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "REPORT_RENDER_FAILED");
    } finally {
      clearTimeout(timer);
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
      // Windows can hold the profile briefly. A leftover holds no credentials.
      await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
    }
  };
}
// Structural checks for a complete PDF. They do not judge its content.
export function inspectPdf(pdf: Buffer) {
  if (pdf.length < 1000 || pdf.length > 20 * 1024 * 1024) return null;
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  if (!pdf.subarray(-1024).toString("latin1").trimEnd().endsWith("%%EOF")) return null;
  const pages = pdf.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
  return pages ? { pages, size: pdf.length } : null;
}
