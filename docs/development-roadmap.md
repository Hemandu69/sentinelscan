# Development roadmap

| Stage | Status | Acceptance evidence or remaining work |
|---|---|---|
| 0 · Architecture | Accepted | Local-only, account-free workspace and three independent component repositories approved. |
| 1 · Infrastructure | Verified | Windows host reported healthy PostgreSQL and ZAP containers with loopback bindings. |
| 2 · Backend foundation | Verified | Prisma generated the client and applied the foundation migration. PostgreSQL lifecycle and persisted consent test passed. |
| 3 · Provider integration | Partial | Authenticated version and alert-page reads passed against ZAP 2.17.0. Missing and invalid keys closed the connection, with successful valid-key controls. The inspection command read both scan listings; each returned zero runs. |
| 4 · Assessment records | Implemented with fixture coverage | Operator receipt association, refresh and transactional import are available. Live import and restart verification remain pending. |
| 5 · Web foundation | Implemented | The operator verified website registration and three operational service indicators on Windows. |
| 6 · Product workflow | Implemented in part | Assessment detail, findings exploration and a printable assessment report are available. Browser PDF export and the integrated operator journey await acceptance. |
| 7 · Quality | Fixture-verified | Built pages pass fixture browser checks for layout, structure, contrast, loading, empty, error and print states. The live integrated workflow remains unverified. |
| 8 · Handover | Documented, unverified | Reproduce setup and local recovery on Windows. |

The separate "Stage 6 · Final Integration, Reliability & Submission Readiness" request covers offline hardening across these roadmap stages. It included no live scan, migration or container change.

## Run storage migration

A verified-backup file and a regenerated client dated November 23 indicate that the migration script ran at least that far. Whether the migration is applied has not been confirmed. Check it read-only before starting the API.

## Stage 3 persistence evidence

The initial empty inventory was a baseline. On November 22 the operator recorded Spider 0 at FINISHED and 100%. Active Scan 0 started, individual rules executed, and Docker later reported an OOM kill. The recovered evidence did not establish the active run's final outcome or attributed alert count. The historical inventory has no authority over a new provider session.

Two live database tests passed on the host. A failed batch containing an invalid fixture left zero findings and the assessment in PROCESSING_RESULTS. Concurrent fixture finalization produced one finding and a COMPLETED assessment. Repeat import preserved the row, count and completion timestamp.

## Open acceptance criteria

Verify a run visible in the operator interface belongs to the configured provider and matches the authorized target. Establish how to distinguish successful completion from cancellation, failure and missing history. Then retrieve all scan-specific results, import them, independently query PostgreSQL for assessment status and severity counts, and repeat the import. An empty scan listing supplies no evidence about finding counts. Genuine end-to-end results, the new Watchtower receipt controls and PDF reporting still need acceptance. See the [submission guide](submission.md) for the current scan evidence and final integration sequence.
