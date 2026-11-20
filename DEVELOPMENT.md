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
```

The database suite uses synthetic findings against real PostgreSQL. The ZAP suite reads a version and an alert page. A passing result for either suite covers only that boundary. Genuine import acceptance also requires independent database verification of a specific operator run.

## Review documentation changes

Resolve relative links from the file containing them. Compare routes and payloads to the API source, port bindings to Compose, and milestone claims to observed results. Stage only documentation and ignore rules. Inspect the staged diff before committing.
