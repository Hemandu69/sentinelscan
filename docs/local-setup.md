# Local setup on Windows

Use Windows PowerShell, Docker Desktop with the Linux engine, Node.js 24 and npm. Place the API and infrastructure checkouts beside each other. The examples start in their common parent directory. Keep the docs checkout separate.

## Configure private local settings

For a fresh checkout, create each component’s private .env from its own .env.example. Preserve existing files and the password associated with an existing PostgreSQL volume. Set independent database and ZAP secrets in the infrastructure checkout. Configure the API database URL to use the matching database user and password, host 127.0.0.1, port 5432, database sentinelscan and query schema=sentinelscan. URL-encode special characters in connection credentials.

The API reads ZAP_API_KEY from its process environment or the sibling infrastructure .env. Its ZAP administration address is fixed. Keep private configuration out of this repository.

## Start services in the approved integration window

For the existing installation, preserve recovery evidence and use the [submission sequence](submission.md) before changing service lifetimes. The following startup command reuses existing containers. Applying a reviewed image or resource change to ZAP requires a separate deployment decision.

```powershell
Set-Location -LiteralPath '.\sentinelscan-infrastructure'
docker --context desktop-linux info --format '{{.OSType}}'
docker --context desktop-linux compose up -d --no-recreate --wait --wait-timeout 180 postgres zap juice-shop
docker --context desktop-linux compose ps
node .\verify-zap.cjs
```

Expect Linux engine access, healthy services and host bindings on 127.0.0.1. The verifier prints the version and checks rejection of absent and incorrect keys. Resolve any failure before continuing.

For an existing installation, follow the [backup and migration steps](submission.md) before applying the run-storage migration. Preserve the current provider session while collecting evidence.

## Prepare and run the API

For a fresh installation use the commands below. On the existing workspace, use the backup-verified migration procedure in the submission guide before starting a version of the API that reads assessment_runs. On either installation, opt into the exact Juice Shop registration and consent scope in the API terminal.

```powershell
Set-Location -LiteralPath '..\sentinelscan-api'
npm.cmd ci
npm.cmd run generate
npm.cmd run migrate
npm.cmd run test:database
npm.cmd run test:zap:live
$env:SENTINELSCAN_DEMO_TARGET = 'juice-shop'
npm.cmd start
```

Run each command after the preceding one succeeds. The last command runs the API in the foreground. From a second PowerShell window, use `Invoke-RestMethod http://127.0.0.1:4000/health`. In the API checkout, `npm.cmd run inspect:zap` reads existing scan listings. An empty listing is valid.

To stop the API, press Ctrl+C in its terminal. To stop the containers and retain their data, run `docker --context desktop-linux compose stop` from the infrastructure checkout.

## Run Watchtower

In another PowerShell terminal open the sibling web checkout and run the following. Keep the terminal open and visit http://127.0.0.1:3000/. The development server binds to loopback. For a production build use `npm.cmd run build` and `npm.cmd start` in the web checkout with the development server stopped.

```powershell
Set-Location -LiteralPath 'C:\Users\hemen\OneDrive\Documents\codes\SentinelScan\sentinelscan-web'
npm.cmd ci
npm.cmd run dev
```
