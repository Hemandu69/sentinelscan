# Architecture

One Windows host. Watchtower talks to Fastify over loopback. Fastify owns consent, scans, evidence validation and database transactions, and is the only component that holds the ZAP key.

| Component | Host interface | Role |
|---|---|---|
| Web | 127.0.0.1:3000 | Watchtower, Next.js 16 |
| API | 127.0.0.1:4000 | Fastify 5 |
| PostgreSQL 17 | 127.0.0.1:5432 | Schema `sentinelscan`, named volume |
| ZAP 2.17.0 | 127.0.0.1:8090 | Scanner, contacted by the API only |
| Juice Shop | 127.0.0.1:3001 | The only scan target, `http://juice-shop:3000/` inside Docker |

## Data

| Table | Purpose |
|---|---|
| targets | Canonical URL and name. Archiving preserves history. |
| assessments | Authorized URL, consent time and wording version, status and times |
| assessment_runs | One Spider and one Active Scan receipt per assessment |
| run_evidence | Insert-only evidence facts, outcome and digest per receipt |
| findings | Unique per assessment and fingerprint |
| reports | One row per stored PDF with SHA-256 |
| finding_analyses | Optional AI interpretation. Migration written, not applied. |

## Scan flow

1. The operator registers the demo and confirms permission. Consent is single-use and bound to the address.
2. Readiness is checked: policy, memory, health, log, storage, firewall image, no other scan.
3. The firewall is applied to ZAP and proven. A new ZAP session starts.
4. The Spider runs and is verified. The Active Scan runs. Memory, scope, errors, time and firewall are watched.
5. Evidence is collected twice and must be identical and complete. Findings and completion are stored in one transaction.
6. ZAP is locked.

Anything unproven ends as OUTCOME_UNKNOWN and imports nothing. Repeating an import changes nothing. Progress is held in memory: after an API restart, use Check outcome.
