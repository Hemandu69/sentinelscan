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
| GET /api/v1/integrations/zap/status | Reads availability and version. |
| GET /api/v1/integrations/zap/version | Returns the authenticated provider version. |
| GET /api/v1/integrations/zap/alerts | Returns normalized global alerts. Query parameters start and count default to 0 and 50; count is limited to 100. |
| GET /api/v1/integrations/zap/progress/:kind/:scanId | Reads progress for an existing numeric scan ID. Supported kinds are spider and active. |

## Consent exchange

Read the target detail, show the returned URL and consent wording to the operator, then submit targetId, url, authorized (true), authorizationTextVersion and confirmationToken. The token is single-use, bound to the target and URL, and expires after five minutes. A stale confirmation requires a fresh target read.

## Provider contract

The diagnostic CLI and HTTP discovery read the provider inventory. Global alerts cannot establish run attribution. Watchtower uses the following assessment-scoped suffixes under /api/v1/assessments/:id.

| Method and suffix | Input and result |
|---|---|
| GET /execution | Saved status and run rows for any assessment, without provider access, including kind, scan_id, state, progress and observed_at. |
| POST /zap-association | kind, scanId, sessionKey, target, confirmedOperatorReceipt=true. Returns the saved row. |
| POST /zap-sync | Empty object. Refreshes the saved observations and returns status and runs. |
| POST /cancel-tracking | confirmed=true. Closes any open assessment locally, including archived and non-demo websites. Returns status and providerScanStopped=false. Never contacts ZAP. |
| POST /zap-import | Empty object. Returns status and findingCount after verified import or idempotent replay. |

GET /api/v1/integrations/zap/session-fingerprint returns a nonsecret sessionKey. Watchtower does not call it. The operator captures it with `npm.cmd run zap:session` in the API checkout while the run is in the current session. A receipt requires evidence captured during that session. The production inventory adapter currently has no trusted successful terminal cause. See [submission](submission.md) for the import gate.

## Operator-controlled assessment records

| Read endpoint | Contents |
|---|---|
| GET /api/v1/assessments | Newest assessments first. Optional targetId and offset. |
| GET /api/v1/assessments/:id | Authorized URL snapshot, website, stored status and timestamps. startedAt is the first time an associated run was observed RUNNING. Finding count is null until completion. |
| GET /api/v1/findings | Completed assessment findings. Optional assessmentId, severity, title search q and offset. |
| GET /api/v1/integrations/zap/scans?kind=spider or kind=active | Runs visible on the fixed local provider, reported state, progress and origin if available. |

Record lists return up to 25 items and a hasMore flag. Database and provider failures are errors. The provider endpoint and version identify the configured service address. They cannot distinguish session resets or reused scan IDs. A reported origin omits credentials, paths, query strings and fragments and cannot establish authorized path scope.

The API process can accept the exact demo address for **registration and consent records only** when started with SENTINELSCAN_DEMO_TARGET=juice-shop. The canonical address is http://juice-shop:3000/ including the trailing slash. The ordinary outbound destination policy remains in force.

Use npm.cmd run inspect:zap and npm.cmd run test:zap:live in the API checkout for host-side read-only discovery. Use npm.cmd run test:database for the database fixture and read-back checks. A fresh assessment can be viewed in the Watchtower Assessments list. The previous interrupted active run has no verified terminal outcome. No association or final import can be accepted from its historical numeric ID. Durable association still requires run-specific evidence binding the authorized scope, successful outcome, and provider session. The read-only client can retrieve normalized records by attributed IDs; its output alone cannot finalize an assessment.

The findings list accepts sort=newest (default), oldest or title. Sorting is applied before pagination with the record ID as a stable tie-breaker. Finding details include the stored HTTP method and parameter when supplied.

GET /api/v1/assessments/:id/zap-observations/:kind/:scanId reads a single provider observation for an authorized demo assessment. The assessment detail page permits selecting a listed run. It timestamps each observation, stops on unknown or terminal states, and permits stopping observation without changing the run. Transport errors trigger at most two delayed retries. An observation does not establish durable run ownership or authorize finalization.
