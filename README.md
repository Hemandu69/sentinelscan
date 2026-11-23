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
| `restrict-secret-access.ps1` | Reports, or with `-Apply` removes, one group's access to the backups and both `.env` files. Preserves every other entry. |
| `rotate-zap-key.cjs` | Confirms the log override and the configured image is available locally, twice, before writing a new key. Then recreates ZAP and checks that the new key is absent from its log. Requires approval. |
| `reset-and-verify.ps1` | Reports, or with `-Remove` removes, only the containers named by `-Service`. Checks name and Compose labels first. ZAP also needs `-DiscardZapSession`. Never removes images, volumes or networks. |

## Key exposure and rotation

ZAP 2.17.0 logs rejected keys, and at startup logs every `-config` value including `api.key`. `verify-zap.cjs` therefore refuses with an unrelated random key, and `zap-log4j2.properties` suppresses the startup lines. The suppression is tested offline only; rotation checks it on the real container. Keys in logs written before this change remain exposed until that container is removed.

Rotation procedure, in an approved window:

1. Export any run evidence you need. Recreating ZAP discards its container log, session and alerts, and permanently changes the session fingerprint.
2. Make the configured image available locally (a separate approved download).
3. Start the existing PostgreSQL, ZAP and Juice Shop containers. The script requires all three, and an empty run inventory.
4. Stop the API. Confirm that neither the shell nor the API `.env` defines `ZAP_API_KEY`.
5. Run `node .\rotate-zap-key.cjs`. It prints no key.
6. Start the API. It reads the new key from this checkout's `.env`, the same source Compose uses.

If the script fails after "New credential installed", the file holds the new key while the old container may still hold the old one. Run no scans until that is resolved.

## Offline checks

```powershell
docker compose config --quiet
node --test verify-zap.test.cjs observe-zap-resources.test.cjs safety.test.cjs access.test.cjs
```

The tests replace Docker, Node and ZAP with recording fakes. They prove which commands the scripts issue. They do not prove Docker's or ZAP's behavior.
