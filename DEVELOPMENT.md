# Development

Change code, migrations and configuration in their own folder, and update the documents here when a shared interface changes. State what ran, and whether provider, database and input were real or fixtures.

| Folder | Checks |
|---|---|
| API | `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint` |
| Web | the same, `npm.cmd run build`, and the fixture browser scripts in `tests/browser` |
| Infrastructure | `node --test *.test.cjs`, `docker --context desktop-linux compose config --quiet` |

The API's live suites `test:database`, `test:run-storage`, `test:dashboard:live` and `test:zap:live` need healthy local services and are run one at a time. They use fixture findings, clean up or roll back, and start no scan.
