# Development

Keep the documentation checkout beside the component checkouts. Work on code, migrations, dependencies and service configuration in their owning repositories. This checkout has no application build or runtime dependencies.

When a component changes a shared interface, update the [API contract](docs/api-contract.md) and the [architecture](ARCHITECTURE.md) here. Record verification in the [roadmap](docs/development-roadmap.md), including what ran, whether the provider and database were real, and whether the input was a fixture.

## Verify the backend

From the API checkout in Windows PowerShell, run the offline suite and static checks:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
```

With the local services healthy and the database migrated, run each live suite separately:

```powershell
npm.cmd run test:database
npm.cmd run test:zap:live
npm.cmd run test:dashboard:live
npm.cmd run test:run-storage
```

The database suite uses synthetic findings against real PostgreSQL. The ZAP suite reads a version and an alert page. A passing result for either suite covers only that boundary. Genuine import acceptance also requires independent database verification of a specific operator run.

## Review documentation changes

From the web checkout run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd run build`. Browser fixture rendering and a real Windows print-dialog check are separate acceptance steps. From infrastructure run `docker --context desktop-linux compose config --quiet` and `node --test verify-zap.test.cjs observe-zap-resources.test.cjs`. The infrastructure and documentation checkouts have no npm test script.

Resolve relative links from the file containing them. Compare routes and payloads to the API source, port bindings to Compose, and milestone claims to observed results. Stage only documentation and ignore rules. Inspect the staged diff before committing.
