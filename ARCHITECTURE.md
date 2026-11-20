# Architecture

One Windows host runs a shared workspace. The planned Next.js frontend communicates with Fastify over loopback. Fastify owns consent, assessment records, result validation and Prisma transactions. Docker Compose publishes PostgreSQL and ZAP on loopback. Only the backend needs the database connection and ZAP credential.

| Component | Host interface | Current role |
|---|---|---|
| Web | 127.0.0.1:3000 (planned) | Direct-entry dashboard with no login screen |
| API | 127.0.0.1:4000 | Local HTTP service |
| PostgreSQL | 127.0.0.1:5432 | Application database and schema named `sentinelscan`; data lives in a named volume |
| ZAP | 127.0.0.1:8090 | Authenticated provider reads from the configured daemon |

## Data ownership

| Table | Relationship and purpose |
|---|---|
| targets | Stores the canonical URL and display name. Archiving preserves history. |
| assessments | Belongs to a target. Captures the authorized URL, consent timestamp and wording version, source, status and execution timestamps. |
| findings | Belongs to an assessment. A unique assessment/fingerprint pair supports idempotent persistence. |
| reports | Belongs to an assessment. The schema reserves metadata for report snapshots. PDF generation remains planned. |

## Operator-run design

The operator initiates spider and active scans in the configured ZAP instance. SentinelScan is intended to discover those runs, link them to the authorized assessment and explicitly import their final findings. Scan association must verify provider identity, run identity and target scope. A scan ID can be reused across sessions. A matching number or version string alone cannot establish identity.

The importer must establish successful termination and retrieve every attributed alert before finalization. The existing persistence routine locks the assessment and writes findings and completion in one transaction. A verified successful scan may have zero findings. A partial read, ambiguous outcome or provider error leaves the assessment incomplete. Cancelled and failed runs retain distinct outcomes. The complete operator-to-database path still requires live verification.
