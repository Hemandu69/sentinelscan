# SentinelScan infrastructure

Run from this directory in Windows PowerShell with Docker Desktop in Linux container mode. The independent Compose project is named sentinelscan-infrastructure. It contains PostgreSQL 17 and the stable OWASP ZAP daemon. The web and API applications are outside this repository.

## Local setup

Keep the generated .env private. On a fresh checkout copy .env.example to .env and supply two independent random secrets. The database password initializes an empty volume. Preserve it when reusing that volume. The future backend reads its ZAP key privately. Do not paste expanded Compose configuration into reports.

Windows clients use 127.0.0.1:5432 and 127.0.0.1:8090. On the dedicated bridge the service endpoints are postgres:5432 and zap:8090. PostgreSQL stores data in the pgdata named volume. The ZAP allowlist includes loopback and the configured bridge gateway. Confirm that the selected subnet is free on the host.

## Acceptance

Ensure ports 5432 and 8090 are available. An existing project named sentinelscan was observed using 8090. Coordinate the handoff before starting this project. From this repository run:

    docker --context desktop-linux compose config --quiet
    .\verify.ps1

The script starts both services, waits for their health checks, verifies keyed and invalid-key API requests, connects over PostgreSQL TCP, and inserts a unique marker into a diagnostic table. It restarts only this project's two services, waits for health, compares the marker, repeats the API checks and removes its own marker on success. A failed check stops the script. The diagnostic table is separate from the application schema.

For status use docker compose ps. To stop this project while retaining its data use docker compose stop. Keep .env and the named volume together for subsequent runs.
