# Watchtower submission and verification

Watchtower lets an evaluator register a website, confirm permission for an exact URL and inspect assessment records and findings. The Next.js application on loopback port 3000 calls Fastify on port 4000. Only the API contacts ZAP on port 8090. Prisma stores targets, assessments, findings and reports in PostgreSQL 17. The new assessment_runs relation stores one operator receipt per scan type and assessment. Juice Shop uses the dedicated Docker network at http://juice-shop:3000/ and publishes its browser port on loopback.

## Automated checks before the integration window

**Readiness.** A live scan-to-database demonstration is still outstanding. Historical Active Scan 0 has outcome UNKNOWN. Offline import tests supply a trusted result in a fixture. The deployed inventory adapter cannot establish SUCCEEDED, even after an infrastructure recovery. Final acceptance requires a verified, session-bound source for terminal cause and authorized scope. A successful connectivity check cannot resolve this gap.

**Coverage.** The ZAP Compose draft specifies a 3 GiB container limit, a 1.5 GiB JVM heap and concurrency options of two threads per host and one host per scan. Verify their effective runtime values separately. DOM XSS rule 40026 exclusion and a one-request-per-second limit are proposals. Record their readbacks for the actual demo session. If the exclusion is enabled, disclose that DOM-based XSS testing was excluded from that run.

From the API checkout run `npm.cmd test`, `npm.cmd run typecheck` and `npm.cmd run lint`. From the web checkout run the same three commands and `npm.cmd run build`. Node 24 runs the API TypeScript entry point directly. Offline tests use fixture provider responses and transaction doubles. Database constraints and provider compatibility require the live checks below.

## Run association and evidence

For the evaluator, demonstrate the website registry, exact-URL confirmation, pending receipt and assessment history first. Show provider state and observation time separately from the application's assessment status. An incomplete assessment has an unknown finding count. A completed assessment with zero findings has a numeric zero. Without genuine completion evidence, stop the live demonstration at the stored assessment and label any separate print or rollback demonstration as fixture-based.

The normalizer maps Informational, Low, Medium and High provider risks to INFO, LOW, MEDIUM and HIGH. It retains the original risk and confidence. Unrecognized risks lack a normalized severity and block final import. CRITICAL is supported by the display schema. Successful persistence deduplicates by assessment and a fingerprint of rule ID, name, sanitized URL, HTTP method and parameter. Paths remain visible while query strings, fragments and URL credentials are removed from finding URLs.

Use the existing authorized Juice Shop assessment. Only the explicit local demo configuration enables this target. The API checks consent, the registered URL, the snapshot and archive status on writes. The browser receives a nonsecret provider fingerprint. The ZAP credential stays with the API.

| Route | Purpose |
|---|---|
| GET /api/v1/integrations/zap/session-fingerprint | Read a digest of the configured container lifetime, version-checked provider and session location. Record it contemporaneously with the operator's run receipt. |
| GET /api/v1/assessments/:id/execution | Read saved run IDs, provider states, progress and timestamps from PostgreSQL. Works across API restarts. |
| POST /api/v1/assessments/:id/zap-association | Save kind, scanId, sessionKey, exact target and confirmedOperatorReceipt. Bind the Spider first. |
| POST /api/v1/assessments/:id/zap-sync | Refresh the two saved records from their original provider session. |
| POST /api/v1/assessments/:id/cancel-tracking | Record local cancellation with explicit confirmation. The provider run has its own lifecycle. |
| POST /api/v1/assessments/:id/zap-import | Check both receipts, read every scan-attributed alert, validate scope and commit normalized findings and completion together. |

The session digest cannot detect reopening the same session file within the same container process. An ID or a newly computed digest cannot reconstruct a missing historical receipt. A changed session, ambiguous outcome, missing URL, partial response or changing alert-ID set keeps the assessment incomplete. A transient failure permits a retry with the original receipts. Sync runs on request. The application has no scan launcher or background execution worker.

The inventory normalizer confirms RUNNING. FINISHED, a percentage of 100 and unrecognized terminal labels leave the outcome UNKNOWN. The Spider stop path also sets FINISHED. The Active Scan inventory similarly lacks a distinct success reason. Fixture tests independently supply verified outcomes to exercise transactional imports. The production inventory reader cannot produce SUCCEEDED from its listing alone. Run-specific Spider results and Active Scan message IDs can corroborate destinations even for zero alerts. Missing request evidence leaves scope unresolved.

## Final Windows integration window

Use Windows PowerShell 5.1. Preserve the existing ZAP session while collecting its evidence. If Docker Desktop still reports HTTP 500, pause the session and preserve all containers and volumes. Run each command after its predecessor succeeds. For initial private environment setup follow [Local setup](local-setup.md).

1. In the infrastructure checkout verify the Linux engine, inspect existing services and run the authenticated version check. Capture the assessment state and run inventory before changing services or applying migrations.

   ```powershell
   docker --context desktop-linux info --format '{{.OSType}}'
   docker --context desktop-linux compose ps -a
   node .\verify-zap.cjs
   $id = 'b113e0b9-c57f-43a4-86a7-51fe94507c96'
   $base = 'http://127.0.0.1:4000'
   Invoke-RestMethod "$base/api/v1/assessments/$id" | Select-Object id,targetUrlSnapshot,status,findingCount
   Push-Location ..\sentinelscan-api
   npm.cmd run inspect:zap
   Pop-Location
   ```

2. In the API terminal press Ctrl+C. Leave all containers running and stop other writers for the duration of verification. From the infrastructure checkout run the following in Windows PowerShell 5.1. The script requires the existing authorized assessment, healthy database and expected loopback binding. It compares row counts and content fingerprints for targets, assessments, findings and reports before and after deployment. It extracts the entire backup archive for verification and compares the host copy's SHA-256 before Prisma generation.

   ```powershell
   Set-Location -LiteralPath '..\sentinelscan-api' -ErrorAction Stop
   .\verify-and-migrate.ps1
   ```

3. After successful verification run `npm.cmd run test:run-storage`, `npm.cmd run test:database`, `npm.cmd run test:dashboard:live` and `npm.cmd run test:zap:live` sequentially. Keep test fixture counts separate from genuine findings.

4. Start the API with its existing demo configuration (`$env:SENTINELSCAN_DEMO_TARGET = 'juice-shop'`, then `npm.cmd start`). Start Watchtower separately from the web checkout with `npm.cmd run dev`. Open the existing assessment at http://127.0.0.1:3000/assessments/b113e0b9-c57f-43a4-86a7-51fe94507c96. Verify the exact target, permission and assessment state. Associate only independently documented operator receipts and refresh progress. If scope, identity or outcome remains unknown, show that state in the demonstration and leave the finding count unknown.

5. For an eligible completed run, choose **Verify and import results**. Record the returned finding count and independently query PostgreSQL from the infrastructure checkout. Compare status and grouped counts with Watchtower's assessment and findings pages. A successful repeat import must preserve both counts and the completion timestamp.

   ```powershell
   $query = @'
   SELECT id,status,finished_at FROM sentinelscan.assessments
   WHERE id='b113e0b9-c57f-43a4-86a7-51fe94507c96';
   SELECT normalized_severity,count(*) FROM sentinelscan.findings
   WHERE assessment_id='b113e0b9-c57f-43a4-86a7-51fe94507c96'
   GROUP BY normalized_severity ORDER BY normalized_severity;
   '@
   $query | docker --context desktop-linux compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U sentinel -d sentinelscan
   ```

6. Record the PostgreSQL check, operator receipts, terminal evidence, attributed alert count and UI result separately from fixture test totals. Review any difference between the alert count and persisted finding count using the deduplication identity (rule, name, URL, method and parameter). Keep raw alert evidence and credentials out of presentation materials.

### Interpreting the run evidence

An assessment records the operator's permission for one URL. The Spider discovers reachable URLs. The active check tests the application and can produce alerts. Numeric IDs are local to a provider session and scan type. In PowerShell, read the original Spider and Active Scan inventory with `npm.cmd run inspect:zap`. To investigate observed destinations independently of alert count, run the following from the API checkout while the original session is available.

```powershell
npm.cmd run inspect:zap -- --scope spider 0
npm.cmd run inspect:zap -- --scope active 0
```

The first command reads this Spider's results. The second reads only messages referenced by this Active Scan and returns a count and scope classification. Empty or ambiguous evidence, a changed message list, and a review limit prevent a positive scope conclusion. A matching observed destination corroborates the target; it does not prove original authorization, identify the operator or distinguish cancellation from successful completion.

The importer reads each alert listed for the bound active scan, preserves provider severity and confidence, normalizes severity for display, and redacts sensitive evidence. PostgreSQL commits findings and completion together. Watchtower groups persisted findings by severity and shows the provider's remediation per finding. The print view reads every page, rejects inconsistent totals and only then enables printing. Chrome print checks in `tests/browser/report-print.mjs` use synthetic data and do not contact ZAP or PostgreSQL.
