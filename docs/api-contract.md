# Local API contract

Base origin: `http://127.0.0.1:4000`. Send JSON bodies for create requests. Application errors return an `error` code and a `requestId`. The shared workspace has no user authentication.

| Method and path | Current behavior |
|---|---|
| GET /health | Returns process health. |
| GET /health/database | Performs a database read. Returns 503 on database failure. |
| GET /health/zap | Reads the provider version and returns availability and version on success. |
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

## Planned provider contract

Scan discovery is available as a diagnostic CLI probe. HTTP run association and explicit assessment import are planned. A global alert page cannot identify the final findings for an individual assessment. Import success must reflect the complete run-specific result set and a committed database transaction.
