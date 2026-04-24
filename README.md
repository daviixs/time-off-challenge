# Time-Off Microservice Challenge

NestJS + Prisma + SQLite implementation of a defensive time-off microservice that treats HCM as the authoritative balance source.

## What it does
- Manages time-off request lifecycle: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`
- Caches HCM balances locally with freshness checks
- Revalidates balance against HCM before approval
- Restores balance through HCM when cancelling approved requests
- Accepts inbound realtime and batch HCM syncs
- Marks pending requests `atRisk` when refreshed balances can no longer cover them
- Audits inbound sync runs and outbound HCM operations

## Stack
- NestJS 11
- Prisma 7 + `@prisma/adapter-better-sqlite3`
- SQLite
- Jest + Supertest

## Environment
Create `.env` with:

```env
DATABASE_URL="file:./dev.db"
HCM_BASE_URL="http://127.0.0.1:4010"
BALANCE_TTL_MS="300000"
HCM_TIMEOUT_MS="2000"
PORT="3000"
```

## Install and run
```bash
npm install
npm run prisma:generate
npm run db:push
npm run db:seed
npm run start:dev
```

## Mock auth
User-facing endpoints require trusted headers:

```http
x-user-id: emp-001
x-role: EMPLOYEE
```

or

```http
x-user-id: mgr-001
x-role: MANAGER
```

## Scripts
```bash
npm run build
npm run lint
npm test
npm run test:e2e
npm run prisma:generate
npm run db:push
npm run db:seed
```

## API surface
- `GET /health`
- `POST /time-off/requests`
- `GET /time-off/requests`
- `GET /time-off/requests/:id`
- `PATCH /time-off/requests/:id/approve`
- `PATCH /time-off/requests/:id/reject`
- `PATCH /time-off/requests/:id/cancel`
- `GET /balances`
- `POST /sync/realtime`
- `POST /sync/batch`

## Testing
- Unit tests: pure policy and service behavior
- Integration tests: real Nest graph + Prisma repositories + injected HCM mock
- E2E tests: HTTP flows + real mock HCM server

The mock HCM server lives in [test/support/mock-hcm-server.ts](test/support/mock-hcm-server.ts).

## TRD
The technical requirements document is at [docs/time-off-microservice-trd.md](docs/time-off-microservice-trd.md).
