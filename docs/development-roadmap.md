# Development roadmap

| Stage | Status | Acceptance evidence or remaining work |
|---|---|---|
| 0 · Architecture | Accepted | Local-only, account-free workspace and three independent component repositories approved. |
| 1 · Infrastructure | Verified | Windows host reported healthy PostgreSQL and ZAP containers with loopback bindings. |
| 2 · Backend foundation | Verified | Prisma generated the client and applied the foundation migration. PostgreSQL lifecycle and persisted consent test passed. |
| 3 · Provider integration | Partial | Authenticated version and alert-page reads passed against ZAP 2.17.0. Missing and invalid keys closed the connection, with successful valid-key controls. The inspection command read both scan listings; each returned zero runs. |
| 4 · Assessment records | Planned | Validate the complete operator-linked assessment lifecycle and recovery. |
| 5 · Web foundation | Planned | Implement and verify the Next.js dashboard. |
| 6 · Product workflow | Planned | Verify the operator journey, findings views and PDF reports. |
| 7 · Quality | Planned | Exercise the integrated workflow, accessibility, responsive layouts and failure cases. |
| 8 · Handover | Planned | Reproduce setup and local recovery on Windows. |

## Stage 3 persistence evidence

Two live database tests passed on the host. A failed batch containing an invalid fixture left zero findings and the assessment in PROCESSING_RESULTS. Concurrent fixture finalization produced one finding and a COMPLETED assessment. Repeat import preserved the row, count and completion timestamp.

## Open acceptance criteria

Verify a run visible in the operator interface belongs to the configured provider and matches the authorized target. Establish how to distinguish successful completion from cancellation, failure and missing history. Then retrieve all scan-specific results, import them, independently query PostgreSQL for assessment status and severity counts, and repeat the import. An empty scan listing supplies no evidence about finding counts. Genuine end-to-end results, the frontend and PDF reporting remain unverified.
