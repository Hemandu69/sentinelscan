# SentinelScan

SentinelScan is a college project: a local web application security assessment platform. It runs OWASP ZAP against the Juice Shop demo, verifies the evidence, explains the findings in plain language and creates PDF reports. One operator uses it on one Windows machine. There are no accounts and no cloud services.

The distinction between a pending assessment, an interrupted one and a completed one with zero findings matters throughout.

| Repository | Responsibility |
|---|---|
| sentinelscan-web | Watchtower: dashboard, website workspaces, AI Analysis, findings, reports |
| sentinelscan-api | Fastify API, PostgreSQL persistence, ZAP control, evidence, reports |
| sentinelscan-infrastructure | PostgreSQL, ZAP, Juice Shop and the outbound firewall |

| Document | Content |
|---|---|
| [Local setup](docs/local-setup.md) | Install and start |
| [Demonstration guide](docs/submission.md) | What to show, what is verified, what to disclose |
| [Architecture](ARCHITECTURE.md) | Components, data and scan flow |
| [API contract](docs/api-contract.md) | Routes |
| [Security model](docs/security-model.md) | Boundaries and limits |
| [Run evidence contract](docs/run-evidence-design.md) | When a scan counts as successful |
| [Finding intelligence](docs/finding-intelligence.md) | Issues and optional AI |
| [Roadmap](docs/development-roadmap.md) | Status and remaining work |
