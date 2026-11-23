# SentinelScan · The Watchtower

This independent frontend repository contains the Overview, website details, assessments, findings and printable report. It runs on Windows with Node.js 24 and npm. Start the SentinelScan API on port 4000, then run these commands from this checkout.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:3000. The browser defaults to http://127.0.0.1:4000 for Fastify. To change between supported loopback hostnames, copy .env.example to .env.local and set NEXT_PUBLIC_API_BASE_URL. Match the Fastify host and browser-origin settings to the addresses in use. The frontend requires no secrets or external fonts.

## Overview data

| UI | Fastify contract |
|---|---|
| Registered website count and five most recent registrations | GET /api/v1/targets; successful responses are newest first |
| Add website | POST /api/v1/targets with displayName and url |
| Application API | GET /health |
| Database | GET /health/database |
| ZAP security service | GET /health/zap |

Refresh retries the registry and the three service reads independently. The site register treats an empty array as a verified zero. A failed read shows an unavailable state. GET /api/v1/dashboard supplies assessment totals and severity counts from completed checks. The dashboard shows an issue count only once a check has completed. To compare the endpoint with independent SQL counts, run npm.cmd run test:dashboard:live in the API repository while the workspace is idle.

The section navigation links to the implemented areas of the Overview. The theme is stored on this device. The watchtower artwork is bundled locally.

## Website details and authorization

Open Websites and choose View Details. The page loads the registered address and date from GET /api/v1/targets/:id. Create Security Check requests fresh authorization wording for the exact address. Cancel dismisses the dialog. Checking the permission statement and choosing Create security check submits POST /api/v1/assessments once. A successful response shows the pending assessment ID and refreshes the website. Website history refreshes after creation. Open Assessments for the persisted record, or Findings to search completed results. Scan execution is separate.

## Run records

Saved scan records list operator receipts. Enter the run ID and session fingerprint that you captured with `npm.cmd run zap:session` in the API checkout. The page never fetches or fills in a fingerprint. Cancel local tracking closes the record in SentinelScan only. It never stops a ZAP scan. A saved run that is no longer running has an unknown outcome.

## Checks

Completed assessments include a printable report. Open **Assessments**, select the completed check, then choose **Open printable assessment report**. The report reads all persisted findings for the assessment and checks the count and severity totals before enabling **Print or save PDF**. Choose the browser's PDF destination to save locally. Incomplete assessments retain an unknown result count.

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd start
```

With the built server running, the fixture browser checks need an existing Playwright core package and Chrome. They intercept every API request.

```powershell
node tests/browser/app.mjs <playwright-core index.js> <chrome.exe>
```

The production server binds to loopback. Screenshots in screenshots/ show the built light and dark desktop layouts and mobile layout during an unavailable API reading.
