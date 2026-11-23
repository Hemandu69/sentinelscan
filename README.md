# SentinelScan

SentinelScan is a local-first workspace for recording authorized web assessments and reviewing findings. This repository holds the architecture, cross-repository contracts, setup instructions, and project roadmap. Each application component has its own Git history and release lifecycle.

An evaluator should be able to trace a finding from a specific authorized website through the provider run to its stored result. The distinction between a pending assessment, an interrupted check and a completed assessment with zero findings matters throughout the dashboard and report.

| Independent repository | Responsibility |
|---|---|
| sentinelscan-web | Next.js Watchtower dashboard, website registry, assessment details and findings explorer |
| sentinelscan-api | Fastify HTTP API, Prisma schema and migrations, PostgreSQL persistence, read-only ZAP integration |
| sentinelscan-infrastructure | Local Docker Compose services for PostgreSQL, OWASP ZAP and Juice Shop |

Stages 0–2 are accepted. Stage 3 has verified live provider reads and database transactions. Importing the results of a genuine operator-initiated run remains the next acceptance milestone.

The assessment page can store operator run receipts, refresh observed progress and request a verified findings import. The submission guide covers the new storage migration, offline checks, evidence requirements and one final Windows integration session. [Submission and verification guide](docs/submission.md)

[Architecture](ARCHITECTURE.md) · [Development guide](DEVELOPMENT.md) · [Roadmap and evidence](docs/development-roadmap.md) · [Local setup](docs/local-setup.md) · [API contract](docs/api-contract.md) · [Security model](docs/security-model.md)
