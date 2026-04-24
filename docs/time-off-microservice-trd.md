# Time-Off Microservice TRD

## Summary
This service is a NestJS-based time-off microservice that sits between ExampleHR users and an authoritative HCM balance system. It owns request workflow state, maintains a local balance projection cache, ingests batch and realtime HCM sync events, and only finalizes approvals or approved-request cancellations after the HCM confirms the corresponding balance mutation.

## Core Requirements
- HCM is the source of truth for balance values by `(employeeId, locationId, leaveType)`.
- Local state is authoritative for request workflow status.
- Employees may create and read only their own requests and balances.
- Managers may approve, reject, list, and cancel any request.
- Requests use inclusive calendar-day duration.
- Overlapping `PENDING` or `APPROVED` requests for the same employee, location, leave type, and date range are rejected.
- Approval always revalidates against HCM before consumption.
- Cancelling an approved request performs a compensating HCM restore.
- Batch and realtime HCM syncs upsert local balance projections and mark pending requests `atRisk` when the refreshed balance can no longer cover them.

## Architecture
- `RequestsService`: create, approve, reject, and cancel workflows.
- `BalancesService`: TTL-based balance freshness and authoritative refresh from HCM.
- `SyncService`: realtime and batch ingestion, precedence checks, and `atRisk` recomputation.
- `HcmClientService`: outbound HCM HTTP client with error normalization and operation audit logging.
- Prisma repositories: employees, balances, time-off requests, sync logs, and HCM operation logs.
- Mock auth: trusted `x-user-id` and `x-role` headers.
- Persistence: Prisma + SQLite, with the Prisma 7 `better-sqlite3` adapter.

## Data Model
- `Employee`
  - Local reference only for ownership and role checks.
  - Fields: `id`, `name`, `email`, `role`, timestamps.
- `Balance`
  - Local HCM projection keyed by `(employeeId, locationId, leaveType)`.
  - Fields: `availableDays`, `lastSyncedAt`, `sourceUpdatedAt`, `version`, timestamps.
- `TimeOffRequest`
  - Request workflow aggregate.
  - Fields: date range, `durationDays`, `status`, notes, resolver fields, `hcmTransactionId`, `atRisk`, timestamps.
- `SyncLog`
  - One row per inbound sync request, with processed and skipped counts.
- `HcmOperationLog`
  - One row per outbound HCM call, including idempotency metadata and error details.

## Main Flows
### Create request
1. Parse actor headers and require `EMPLOYEE`.
2. Validate date range and inclusive duration.
3. Reject overlapping `PENDING` or `APPROVED` requests.
4. Refresh the local balance from HCM if the projection is stale or missing.
5. Reject if the projected balance is insufficient.
6. Persist the request as `PENDING`.

### Approve request
1. Require `MANAGER`.
2. Load the request and require `PENDING`.
3. Fetch the authoritative balance from HCM and upsert the local projection.
4. Reject if the authoritative balance is insufficient.
5. Call HCM `consume` with an idempotency key derived from the request id.
6. Upsert the returned balance projection.
7. Conditionally transition the request to `APPROVED` and persist the HCM transaction id.

### Reject request
1. Require `MANAGER`.
2. Load the request and require `PENDING`.
3. Transition directly to `REJECTED`.

### Cancel request
1. Allow managers to cancel any request and employees to cancel only their own.
2. Require `PENDING` or `APPROVED`.
3. If `APPROVED`, call HCM `restore` with an idempotency key, then upsert the returned balance.
4. Transition the request to `CANCELLED`.

### Sync flows
- `POST /sync/realtime`: upsert one balance projection and recompute `atRisk` for pending requests in that dimension.
- `POST /sync/batch`: upsert multiple balances, skipping older records when a fresher `sourceUpdatedAt` already exists locally.

## Public API
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

## Error Contract
The API normalizes business failures to:
- `UNAUTHENTICATED`
- `FORBIDDEN_ROLE`
- `EMPLOYEE_NOT_FOUND`
- `REQUEST_NOT_FOUND`
- `INVALID_DATE_RANGE`
- `OVERLAPPING_REQUEST`
- `INSUFFICIENT_BALANCE`
- `REQUEST_NOT_PENDING`
- `INVALID_DIMENSION`
- `HCM_UNAVAILABLE`
- `HCM_RESULT_UNKNOWN`
- `HCM_WRITE_FAILED`

## Configuration
- `DATABASE_URL`
- `HCM_BASE_URL`
- `BALANCE_TTL_MS`
- `HCM_TIMEOUT_MS`
- `PORT`

## Test Strategy
- Unit tests cover policy helpers and pure request/balance/sync service behavior.
- Integration tests cover the real Nest dependency graph with Prisma repositories and an injected HCM client mock.
- E2E tests cover HTTP flows against the running Nest app and a real mock HCM server.
- The mock HCM server supports seed/reset controls, scenario injection, call introspection, and idempotent consume/restore handling.

## Known Trade-offs
- The service uses mock header auth because auth is intentionally out of scope for the challenge.
- SQLite is sufficient for challenge delivery, but production deployment should move to PostgreSQL and add stronger row-level concurrency controls around balance reservations if HCM write guarantees are weaker than assumed.
