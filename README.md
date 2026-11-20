# SentinelScan

SentinelScan is a local-first workspace for recording authorized web assessments and reviewing findings. This repository holds the architecture, cross-repository contracts, setup instructions, and project roadmap. Each application component has its own Git history and release lifecycle.

| Independent repository | Responsibility |
|---|---|
| sentinelscan-web | Planned Next.js operator dashboard |
| sentinelscan-api | Fastify HTTP API, Prisma schema and migrations, PostgreSQL persistence, read-only ZAP integration |
| sentinelscan-infrastructure | Docker Compose configuration for PostgreSQL and OWASP ZAP |

Stages 0–2 are accepted. Stage 3 has verified live provider reads and database transactions. Importing the results of a genuine operator-initiated run remains the next acceptance milestone.

[Architecture](ARCHITECTURE.md) · [Development guide](DEVELOPMENT.md) · [Roadmap and evidence](docs/development-roadmap.md) · [Local setup](docs/local-setup.md) · [API contract](docs/api-contract.md) · [Security model](docs/security-model.md)
