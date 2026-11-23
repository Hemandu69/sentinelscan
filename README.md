# SentinelScan infrastructure

Docker Compose project `sentinelscan-infrastructure` for Docker Desktop in Linux container mode. It runs PostgreSQL 17, OWASP ZAP and the Juice Shop demonstration site. The web and API applications live in their own repositories.

| Service | Host address | Network address | Notes |
|---|---|---|---|
| postgres | 127.0.0.1:5432 | postgres:5432 | Data in the `pgdata` named volume |
| zap | 127.0.0.1:8090 | zap:8090 | `zap-stable:2.17.0`, 3072 MiB limit, 1536 MiB heap, 2 threads per host, 1 host per scan |
| juice-shop | 127.0.0.1:3001 | juice-shop:3000 | Scanner target is always `http://juice-shop:3000/` |

These are configured values. Running containers may predate them, so read back the effective values during an approved integration window. DOM XSS rule 40026 exclusion and a one-request-per-second limit are proposals and are not configured.

## Local setup

Keep `.env` private. On a fresh checkout copy `.env.example` to `.env` and set two independent random secrets. The database password initializes an empty volume; preserve it when reusing that volume. Never paste expanded Compose configuration into reports.

Create missing containers without touching existing ones:

```powershell
docker --context desktop-linux compose up -d --no-recreate --wait --wait-timeout 180 postgres zap juice-shop
```

Plain `docker compose up` can replace a container whose configuration changed. Replacing ZAP discards its session and run evidence, so always keep `--no-recreate` unless a replacement is approved.

## Scripts

| Script | Behavior |
|---|---|
| `verify.ps1` | Checks existing containers, the database and ZAP credentials. Never creates or recreates anything. `-PersistenceRestart` also writes a marker in a diagnostic table and restarts PostgreSQL only. |
| `verify-zap.cjs` | Read-only check that the key works and that missing or wrong keys are refused |
| `observe-zap-resources.cjs` | Read-only memory, state and run samples. `--count 1..120 --interval-seconds 1..60` |
| `rotate-zap-key.cjs` | Confirms the configured image is available locally, twice, before writing a new key. Then recreates ZAP. Requires approval. |
| `reset-and-verify.ps1` | Reports, or with `-Remove` removes, only the containers named by `-Service`. Checks name and Compose labels first. ZAP also needs `-DiscardZapSession`. Never removes images, volumes or networks. |

## Offline checks

```powershell
docker compose config --quiet
node --test verify-zap.test.cjs observe-zap-resources.test.cjs safety.test.cjs
```

The tests replace Docker, Node and ZAP with recording fakes. They prove which commands the scripts issue. They do not prove Docker's or ZAP's behavior.
