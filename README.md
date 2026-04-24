# Time-Off Microservice Challenge

NestJS + Prisma + SQLite implementation of a defensive time-off microservice for ReadyOn/ExampleHR-style time-off management, with HCM kept as the authoritative balance source.

## Scope
- Manages request lifecycle: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`
- Stores a local balance projection keyed by `(employeeId, locationId, leaveType)`
- Revalidates against HCM before approval
- Restores HCM balance when cancelling approved requests
- Accepts inbound realtime and batch HCM syncs
- Marks pending requests `atRisk` when refreshed balances no longer cover them
- Audits outbound HCM operations and inbound sync runs

## Stack
- NestJS 11
- Prisma 7 with `@prisma/adapter-better-sqlite3`
- SQLite
- Jest + Supertest

## Environment
Create `.env`:

```env
DATABASE_URL="file:./dev.db"
HCM_BASE_URL="http://127.0.0.1:4010"
HCM_PORT="4010"
BALANCE_TTL_MS="300000"
HCM_TIMEOUT_MS="2000"
PORT="3000"
```

## Install
```bash
npm install
npm run prisma:generate
npm run db:push
npm run db:seed
```

## Run Locally
Terminal 1:

```bash
npm run mock:hcm
```

Terminal 2:

```bash
npm run start:dev
```

The seeded local users are:

```http
x-user-id: emp-001
x-role: EMPLOYEE
```

```http
x-user-id: mgr-001
x-role: MANAGER
```

## Reproducible Demo
1. Reset and seed the mock HCM:

```bash
curl -s -X POST http://127.0.0.1:4010/mock/reset

curl -s -X POST http://127.0.0.1:4010/mock/seed-balance \
  -H 'content-type: application/json' \
  -d '{
    "employeeId":"emp-001",
    "locationId":"loc-nyc",
    "leaveType":"VACATION",
    "availableDays":10,
    "sourceUpdatedAt":"2026-04-24T00:00:00.000Z"
  }'
```

2. Sync that authoritative balance into the service cache:

```bash
curl -s -X POST http://127.0.0.1:3000/sync/batch \
  -H 'content-type: application/json' \
  -d '{
    "balances":[
      {
        "employeeId":"emp-001",
        "locationId":"loc-nyc",
        "leaveType":"VACATION",
        "availableDays":10,
        "sourceUpdatedAt":"2026-04-24T00:00:00.000Z"
      }
    ]
  }'
```

3. Submit a time-off request:

```bash
curl -s -X POST http://127.0.0.1:3000/time-off/requests \
  -H 'content-type: application/json' \
  -H 'x-user-id: emp-001' \
  -H 'x-role: EMPLOYEE' \
  -d '{
    "employeeId":"emp-001",
    "locationId":"loc-nyc",
    "leaveType":"VACATION",
    "startDate":"2026-05-01",
    "endDate":"2026-05-03",
    "notes":"Trip"
  }'
```

4. Approve it as manager:

```bash
curl -s -X PATCH http://127.0.0.1:3000/time-off/requests/<REQUEST_ID>/approve \
  -H 'content-type: application/json' \
  -H 'x-user-id: mgr-001' \
  -H 'x-role: MANAGER' \
  -d '{
    "notes":"Approved"
  }'
```

5. Check the refreshed balance:

```bash
curl -s 'http://127.0.0.1:3000/balances?employeeId=emp-001&locationId=loc-nyc&leaveType=VACATION' \
  -H 'x-user-id: emp-001' \
  -H 'x-role: EMPLOYEE'
```

Expected result after approval: `availableDays = 7`.

## Core Endpoints
- `GET /health`
- `POST /time-off/requests`
- `GET /time-off/requests`
- `GET /time-off/requests/:id`
- `PATCH /time-off/requests/:id/approve`
- `PATCH /time-off/requests/:id/reject`
- `PATCH /time-off/requests/:id/cancel`
- `GET /balances?employeeId=&locationId=&leaveType=`
- `POST /sync/realtime`
- `POST /sync/batch`

## Error Shape
All business failures are normalized to:

```json
{
  "statusCode": 422,
  "error": "INSUFFICIENT_BALANCE",
  "message": "Requested 3 days but only 2 remain."
}
```

Common codes:
- `UNAUTHENTICATED`
- `FORBIDDEN_ROLE`
- `INVALID_DATE_RANGE`
- `OVERLAPPING_REQUEST`
- `INSUFFICIENT_BALANCE`
- `REQUEST_NOT_PENDING`
- `INVALID_DIMENSION`
- `HCM_UNAVAILABLE`
- `HCM_RESULT_UNKNOWN`
- `HCM_WRITE_FAILED`

## Verification
Fast local checks:

```bash
npm run lint
npm run build
npm test -- --runInBand
npm run test:integration
npm run test:e2e -- --runInBand test/time-off.e2e-spec.ts
npm run test:cov -- --runInBand
```

Single command:

```bash
npm run verify
```

Coverage snapshot from the latest local run:
- Statements: `72.8%`
- Branches: `55.42%`
- Functions: `55.42%`
- Lines: `71.7%`

## Requirement-to-Evidence Map
| Requirement | Primary Endpoint / Flow | Evidence |
| --- | --- | --- |
| Inclusive calendar-day duration | request creation | [src/shared/domain/time-off-policy.spec.ts](src/shared/domain/time-off-policy.spec.ts) |
| Reject invalid date ranges | `POST /time-off/requests` | [src/time-off/application/requests.service.spec.ts](src/time-off/application/requests.service.spec.ts) |
| Reject overlapping requests | `POST /time-off/requests` | [src/time-off/application/requests.service.spec.ts](src/time-off/application/requests.service.spec.ts) |
| Refresh stale or missing balance projections | `GET /balances`, request creation | [src/balances/application/balances.service.spec.ts](src/balances/application/balances.service.spec.ts), [src/time-off/application/requests.service.spec.ts](src/time-off/application/requests.service.spec.ts) |
| Revalidate against HCM before approval | `PATCH /approve` | [src/time-off/application/requests.service.approve.spec.ts](src/time-off/application/requests.service.approve.spec.ts), [src/integration/requests.integration.spec.ts](src/integration/requests.integration.spec.ts), [test/time-off.e2e-spec.ts](test/time-off.e2e-spec.ts) |
| Keep request pending when HCM approval fails | `PATCH /approve` | [src/time-off/application/requests.service.approve.spec.ts](src/time-off/application/requests.service.approve.spec.ts), [src/integration/requests.integration.spec.ts](src/integration/requests.integration.spec.ts) |
| Restore HCM balance on approved cancellation | `PATCH /cancel` | [src/time-off/application/requests.service.lifecycle.spec.ts](src/time-off/application/requests.service.lifecycle.spec.ts), [test/time-off.e2e-spec.ts](test/time-off.e2e-spec.ts) |
| Mark pending requests at risk after sync | `POST /sync/realtime` | [src/sync/application/sync.service.spec.ts](src/sync/application/sync.service.spec.ts), [test/time-off.e2e-spec.ts](test/time-off.e2e-spec.ts) |
| Batch sync precedence over stale data | `POST /sync/batch` | [src/sync/application/sync.service.spec.ts](src/sync/application/sync.service.spec.ts) |
| Mock HCM with seed/scenario/call introspection | external integration test fixture | [test/support/mock-hcm-server.ts](test/support/mock-hcm-server.ts), [scripts/mock-hcm-server.js](scripts/mock-hcm-server.js) |

## Deliverables
- TRD: [docs/time-off-microservice-trd.md](docs/time-off-microservice-trd.md)
- Test evidence: [docs/test-evidence.md](docs/test-evidence.md)
- Manual mock HCM runner: [scripts/mock-hcm-server.js](scripts/mock-hcm-server.js)
