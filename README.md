# SentinelScan API

Fastify 5, TypeScript, Prisma and PostgreSQL. Binds to 127.0.0.1:4000 for one local operator. Authentication is intentionally absent. This service alone holds the ZAP key and contacts ZAP. It starts and stops scans only through the controlled scan service, only for the approved demo address, and never requests a registered website itself.

## Configure

Copy `.env.example` to `.env` on a fresh checkout and keep it private. Preserve an existing `.env`. `ZAP_API_KEY` is read from the process environment or the sibling infrastructure `.env`. Set `SENTINELSCAN_DEMO_TARGET=juice-shop` to allow the exact address `http://juice-shop:3000/` for registration, consent and run records.

## Commands (Windows PowerShell)

| Command | Purpose |
|---|---|
| `npm.cmd ci`, then `npm.cmd run generate` | Install and generate the Prisma client |
| `npm.cmd start` | Run the API |
| `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint` | Offline checks. Live suites are skipped. |
| `npm.cmd run zap:session` | Read and display the current provider session fingerprint and its run IDs. Stores and associates nothing. |
| `npm.cmd run inspect:zap` | Read existing provider runs. `-- --evidence <spider id> <active id>` rehearses the evidence contract read-only. |
| `npm.cmd run test:database`, `test:run-storage`, `test:dashboard:live`, `test:zap:live` | Live suites. Run only in an approved integration window. |
| `.\verify-and-migrate.ps1 -AssessmentId <id>` | Back up, verify and migrate an existing database. Requires approval. |

`test:database` creates and deletes its own fixture rows. `test:run-storage` rolls its transactions back.

## Reports

PDF files are rendered from Watchtower's report page with Chrome or Edge and stored in `%LOCALAPPDATA%\SentinelScan\reports`. `npm.cmd run report:adopt -- <assessment id> <pdf> <sha256>` records a PDF that was printed earlier; it copies the file and leaves the original unchanged.

## Optional AI analysis

Disabled unless `SENTINELSCAN_AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set in `.env`. Calls are billed by the provider. Tests never contact it. See the documentation repository's `docs/finding-intelligence.md`.

## Assessment lifecycle

| Field or status | Meaning |
|---|---|
| `startedAt` | First time SentinelScan observed an associated run as `RUNNING`. Never set at creation, and not the provider's own start time. |
| `finishedAt` | Time of the local transition to COMPLETED, FAILED or CANCELLED |
| PENDING, INITIALIZING | No associated run has been observed running |
| SPIDER_RUNNING, ACTIVE_SCAN_RUNNING | Last recorded activity. Refreshing progress after the active run ends moves the assessment to OUTCOME_UNKNOWN. |
| OUTCOME_UNKNOWN | The scans ended, but how is not established. Not a success, failure or cancellation. Verified evidence may still complete it, and the operator may cancel it. |
| PROCESSING_RESULTS | Exists only inside the import transaction |
| COMPLETED | Findings and completion committed together |
| CANCELLED | Local tracking ended by the operator, or a provider cancellation reported by a trusted outcome source |

`POST /api/v1/assessments/:id/cancel-tracking` works for any open assessment, including archived and non-demo websites, because it changes local records only. It never contacts ZAP and returns `providerScanStopped: false`. Association, refresh and import still require the authorized demo scope.

The inventory adapter cannot produce SUCCEEDED, FAILED or CANCELLED. Only evidence contract v1.1 can, through `src/integrations/zap/run-log.ts` and `evidence.ts`. It was verified by one live import on 24 November 2026. See the documentation repository's `docs/run-evidence-design.md`.
