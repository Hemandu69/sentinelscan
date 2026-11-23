# Architecture

One Windows host runs a shared workspace. The Next.js Watchtower frontend communicates with Fastify 5 over loopback. Fastify owns consent, assessment records, result validation and Prisma transactions. PostgreSQL 17 stores the workspace. The API supplies ZAP credentials server-side. Infrastructure diagnostics run separately from the browser.

| Component | Host interface | Current role |
|---|---|---|
| Web | 127.0.0.1:3000 | Dashboard, website details, assessment records, findings and print view |
| API | 127.0.0.1:4000 | Local HTTP service |
| PostgreSQL | 127.0.0.1:5432 | Application database and schema named `sentinelscan`; data lives in a named volume |
| ZAP | 127.0.0.1:8090 | Authenticated provider reads from the configured daemon |
| Juice Shop | 127.0.0.1:3001 | Authorized demonstration site. Containers reach it at http://juice-shop:3000/. |

## Data ownership

| Table | Relationship and purpose |
|---|---|
| targets | Stores the canonical URL and display name. Archiving preserves history. |
| assessments | Belongs to a target. Captures the authorized URL, consent timestamp and wording version, source, status, first observed running time and finish time. |
| findings | Belongs to an assessment. A unique assessment/fingerprint pair supports idempotent persistence. |
| assessment_runs | Additive migration. One Spider and one active receipt per assessment. A unique session, kind and ID tuple prevents reuse across assessments. |
| run_evidence | Pending migration. Insert-only contract facts, outcome and digest per receipt. |
| reports | Belongs to an assessment. Reserved snapshot metadata. The current print view reconciles live application records and uses the browser print engine without writing this table. |

## Operator-run design

The operator initiates spider and active scans in the configured ZAP instance. SentinelScan lists those runs, stores operator receipts that link them to the authorized assessment, and imports findings only after verification. Scan association must verify provider identity, run identity and target scope. A scan ID can be reused across sessions. A matching number or version string alone cannot establish identity.

The importer must establish successful termination and retrieve every attributed alert before finalization. The existing persistence routine locks the assessment and writes findings and completion in one transaction. A verified successful scan may have zero findings. A partial read, ambiguous outcome or provider error leaves the assessment incomplete. Cancelled and failed runs retain distinct outcomes. Cancelling tracking is a local record change and never stops a provider scan. The complete operator-to-database path still requires live verification.
