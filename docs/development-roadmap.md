# Status

Feature freeze since 24 November 2026. Only repairs, refinement and documentation.

| Area | Status |
|---|---|
| Infrastructure, API, database | Verified |
| Evidence contract v1.1 and import | Verified live once |
| Controlled scans | Fixture-verified. Start and stop were used once live, before the firewall. |
| Outbound firewall | Verified in the real ZAP network. Not yet used by a complete scan. |
| Watchtower, AI Analysis, findings, reports, comparison | Verified with fixtures and the genuine assessment |
| AI provider | Optional, not configured. Its migration `202611240001_finding_analyses` is not applied. |

## Remaining

- One complete scan behind the firewall, started by the owner.
- Dependency updates: Next.js 16.4.6, zod 4.6.7 and Fastify 5.12.8 are applied. Prisma 7 and Vitest 5 are major updates and remain, with smaller transitive ones.
- The Windows permission of `reports` and `recovery` for another local group.
