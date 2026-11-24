# SentinelScan

A college project: a local web application security assessment platform. It runs OWASP ZAP against the Juice Shop demo, verifies the evidence, explains the findings in plain language and creates PDF reports.

One operator uses it on one Windows machine. There are no accounts and no cloud services. **Do not expose its ports to a network.**

## What it does

1. Register the Juice Shop demo and confirm permission.
2. Start a scan. An outbound firewall lets ZAP reach only the demo.
3. SentinelScan collects the evidence twice and imports findings only if everything is proven.
4. Read the findings in plain language, or as the original ZAP records.
5. Preview and download the PDF report.

An unproven scan ends as "outcome unknown" and imports nothing. There is no security score, and the absence of a finding does not show that a website is secure. AI explanations are optional and off by default.

## Repositories

| Repository | Responsibility |
|---|---|
| sentinelscan (this one) | Documentation |
| sentinelscan-web | Watchtower, the Next.js interface |
| sentinelscan-api | Fastify API, PostgreSQL persistence, ZAP control, evidence, reports |
| sentinelscan-infrastructure | PostgreSQL, ZAP, Juice Shop and the outbound firewall |

Clone all four beside each other.

| Part | Version |
|---|---|
| Node.js | 24 |
| Next.js / React | 16.4 / 19.2 |
| Fastify / Prisma / zod | 5.12 / 6.19 / 4.6 |
| PostgreSQL / OWASP ZAP | 17 / 2.17.0 |

## Quick start

Needs Windows, Docker Desktop with the Linux engine, Node.js 24, and Chrome or Edge for PDFs. First create each private `.env` from its `.env.example`; [local setup](docs/local-setup.md) explains every step.

| Checkout | Commands |
|---|---|
| infrastructure | `docker --context desktop-linux compose up -d --no-recreate --wait postgres zap juice-shop`, then `docker --context desktop-linux build -t sentinelscan-egress-guard:1 egress-guard` |
| api | `npm.cmd ci`, `npm.cmd run generate`, `npm.cmd run migrate` (fresh database only), `npm.cmd start` |
| web | `npm.cmd ci`, `npm.cmd run build`, `npm.cmd start` |

Open http://127.0.0.1:3000.

## Status

Feature freeze since 24 November 2026. One genuine assessment is complete: 24 alerts became 2 informational findings. No complete scan has run behind the firewall yet. See [status](docs/development-roadmap.md).

## Documents

| Document | Content |
|---|---|
| [Local setup](docs/local-setup.md) | Install and start |
| [Demonstration guide](docs/submission.md) | What to show, what is verified, what to disclose |
| [Architecture](ARCHITECTURE.md) | Components, data and scan flow |
| [API contract](docs/api-contract.md) | Routes |
| [Security model](docs/security-model.md) | Boundaries and limits |
| [Run evidence contract](docs/run-evidence-design.md) | When a scan counts as successful |
| [Finding intelligence](docs/finding-intelligence.md) | Issues and optional AI |
| [Development](DEVELOPMENT.md) | Checks and tests |

Scan only systems that you own or may test.
