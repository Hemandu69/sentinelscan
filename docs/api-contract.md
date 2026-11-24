# Local API contract

Base origin: `http://127.0.0.1:4000`. Send JSON bodies for create requests. Application errors, including unknown routes (404 NOT_FOUND), return an `error` code and a `requestId`. The shared workspace has no user authentication.

| Method and path | Current behavior |
|---|---|
| GET /health | Returns process health. |
| GET /health/database | Performs a database read. Returns 503 on database failure. |
| GET /health/zap | Reads the provider version and returns availability and version on success. |
| GET /api/v1/dashboard | Reads totalChecks, completedChecks, findingCount and severityCounts from one database snapshot. Counts span the workspace. Findings contribute only when their assessment is COMPLETED. The severity keys are CRITICAL, HIGH, MEDIUM, LOW, INFO and OTHER. A database failure returns an error. |
| GET /api/v1/targets | Lists active targets. |
| POST /api/v1/targets | Accepts displayName and url. Returns 201 on creation, 409 for an active duplicate, or 422 for a prohibited destination. |
| GET /api/v1/targets/:id | Reads one active target and issues an expiring confirmation for its exact URL. |
| DELETE /api/v1/targets/:id | Archives the active target and returns 204. |
| POST /api/v1/assessments | Records consent and creates a PENDING assessment. Returns 201 and the assessment record including its ID. |

## Consent exchange

Read the target detail, show the returned URL and consent wording to the operator, then submit targetId, url, authorized (true), authorizationTextVersion and confirmationToken. The token is single-use, bound to the target and URL, and expires after five minutes. A stale confirmation requires a fresh target read.

## Provider contract

Receipts are written by the scan service only. Watchtower uses these suffixes under /api/v1/assessments/:id.

| Method and suffix | Input and result |
|---|---|
| GET /execution | Saved status and run rows for any assessment, without provider access, including kind, scan_id, state, progress and observed_at. |
| POST /zap-sync | Empty object. Refreshes the saved observations and returns status and runs. |
| POST /cancel-tracking | confirmed=true. Closes any open assessment locally, including archived and non-demo websites. Returns status and providerScanStopped=false. Never contacts ZAP. |
| POST /zap-import | Empty object. Returns status and findingCount after verified import or idempotent replay. Missing evidence answers 409 with fixed `reasons` codes. Trustworthy stop or error evidence closes the assessment as CANCELLED or FAILED with a null findingCount. |

The session fingerprint is not available over HTTP. The inventory alone has no trusted terminal cause. Import follows the [run evidence contract](run-evidence-design.md).

## Controlled scans

| Method and path | Result |
|---|---|
| GET /api/v1/scans/policy | The approved target and the fixed configuration |
| GET /api/v1/scans/readiness | Read-only checks: ready and fixed reason codes |
| POST /api/v1/scans | targetId, url, authorized=true, authorizationTextVersion, confirmationToken, configuration="standard", requestKey (UUID). Returns assessmentId. Repeating a requestKey never starts a second scan. 409 SCAN_NOT_READY carries reasons. |
| GET /api/v1/assessments/:id/scan | Status, tracked, stage, reported progress, memory and stop state |
| POST /api/v1/assessments/:id/scan/cancel | confirmed=true. Stops the scans through ZAP. 409 once results are being verified. |
| GET /api/v1/assessments/:id/comparison?earlier=:id | new, persistent, changed and notSeenAgain for two completed assessments of one website. Not comparable without verified evidence for the same address, contract and rules. resolved is always empty. |

While a controlled scan owns an assessment, the sync, import and cancel-tracking routes answer 409 SCAN_IN_PROGRESS.

## Reports

| Method and path | Result |
|---|---|
| GET /api/v1/assessments/:id/reports | Status, whether generation is possible, and stored reports with time, size, pages, checksum, availability and whether a newer layout or analysis exists |
| POST /api/v1/assessments/:id/reports | Empty body. Generates and stores a new PDF for a completed assessment. Earlier files stay. |
| GET /api/v1/assessments/:id/reports/latest/pdf | The newest PDF. `view=preview` shows it inline. |
| GET /api/v1/assessments/:id/reports/:reportId/pdf | One PDF of this assessment |

The API renders Watchtower's report page with the installed Chrome or Edge, so Watchtower must be running. The browser may reach only this machine. The page counts as ready only after it has reconciled every finding, and the API compares its assessment and finding count with the database. Files live in `%LOCALAPPDATA%\SentinelScan\reports` under generated names; requests never contain a path. Every download is checked against its SHA-256.

## Assessment records

| Read endpoint | Contents |
|---|---|
| GET /api/v1/assessments | Newest assessments first. Optional targetId and offset. |
| GET /api/v1/assessments/:id | Authorized URL snapshot, website, stored status and timestamps. startedAt is the first time an associated run was observed RUNNING. Finding count is null until completion. Completed assessments include a run evidence summary with any accepted exceptions. OUTCOME_UNKNOWN means that the scans ended without verified evidence. |
| GET /api/v1/findings | Completed assessment findings. Optional assessmentId, severity, title search q and offset. |

Record lists return up to 25 items and a hasMore flag. Database and provider failures are errors.

The API process can accept the exact demo address for registration, consent and scans when started with SENTINELSCAN_DEMO_TARGET=juice-shop. The canonical address is http://juice-shop:3000/ including the trailing slash. The ordinary outbound destination policy remains in force.

The findings list accepts sort=newest (default), oldest or title. Sorting is applied before pagination with the record ID as a stable tie-breaker. Finding details include the stored HTTP method and parameter when supplied.

