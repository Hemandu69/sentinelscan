# Local setup on Windows

Use Windows PowerShell, Docker Desktop with the Linux engine, Node.js 24 and npm. Place the API and infrastructure checkouts beside each other. The examples start in their common parent directory. Keep the docs checkout separate.

## Configure private local settings

For a fresh checkout, create each component’s private .env from its own .env.example. Preserve existing files and the password associated with an existing PostgreSQL volume. Set independent database and ZAP secrets in the infrastructure checkout. Configure the API database URL to use the matching database user and password, host 127.0.0.1, port 5432, database sentinelscan and query schema=sentinelscan. URL-encode special characters in connection credentials.

The API reads ZAP_API_KEY from its process environment or the sibling infrastructure .env. Its ZAP administration address is fixed. Keep private configuration out of this repository.

## Start services

```powershell
Set-Location -LiteralPath '.\sentinelscan-infrastructure'
docker --context desktop-linux info --format '{{.OSType}}'
docker --context desktop-linux compose up -d --wait --wait-timeout 180
docker --context desktop-linux compose ps
node .\verify-zap.cjs
```

Expect Linux engine access, healthy services and host bindings on 127.0.0.1. The verifier prints the version and checks rejection of absent and incorrect keys. Resolve any failure before continuing.

## Prepare and run the API

```powershell
Set-Location -LiteralPath '..\sentinelscan-api'
npm.cmd ci
npm.cmd run generate
npm.cmd run migrate
npm.cmd run test:database
npm.cmd run test:zap:live
npm.cmd start
```

Run each command after the preceding one succeeds. The last command runs the API in the foreground. From a second PowerShell window, use `Invoke-RestMethod http://127.0.0.1:4000/health`. In the API checkout, `npm.cmd run inspect:zap` reads existing scan listings. An empty listing is valid.

To stop the API, press Ctrl+C in its terminal. To stop the containers and retain their data, run `docker --context desktop-linux compose stop` from the infrastructure checkout.
