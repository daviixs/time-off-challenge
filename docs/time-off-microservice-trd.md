# Time-Off Microservice TRD

## 1. Summary

ReadyOn needs a dedicated time-off microservice that acts as the workflow system for employees and managers while deferring authoritative balance truth to the HCM. The service must give employees fast feedback, let managers approve safely, and remain correct even when HCM balances change outside ReadyOn through year resets, anniversary grants, or direct HR actions.

This implementation uses NestJS + Prisma + SQLite, exposes REST endpoints for request lifecycle and balance sync, maintains a local balance projection cache, and treats HCM writes as first-class operations with idempotency and defensive validation.

## 2. Key Challenges

- Dual-writer risk: ReadyOn is not the only system mutating HCM balances.
- Stale reads: a locally cached balance may already be invalid when a manager approves.
- HCM error dependence is unsafe: the service cannot assume HCM always rejects insufficient-balance requests correctly.
- Dimensional integrity: balances are scoped by `(employeeId, locationId, leaveType)`.
- Sync asymmetry: the system must support both realtime single-record updates and full-corpus batch updates from HCM.
- User experience tension: employees want immediate feedback, but correctness requires authoritative revalidation.
- Retry ambiguity: timeouts during HCM writes must not lead to duplicate balance consumption.
- Reviewer expectations: the take-home is evaluated on TRD quality, rigor of tests, and clarity of evidence.

## 3. Goals and Non-Goals

### Goals

- Preserve balance integrity when creating, approving, rejecting, and cancelling time-off requests.
- Keep HCM as the source of truth for balances.
- Give fast reads through a local projection with freshness controls.
- Provide clear REST APIs and deterministic error contracts.
- Ship a robust test suite with unit, integration, and e2e coverage, including a realistic mock HCM.

### Non-Goals

- Full authentication platform or login flows.
- Real employee hierarchy management.
- Payroll or holiday-calendar logic.
- Distributed orchestration or asynchronous event buses beyond the service boundary.

## 4. Proposed Solution

### Architecture

- `RequestsService`: owns request creation, approval, rejection, and cancellation.
- `BalancesService`: owns TTL freshness checks and authoritative refresh from HCM.
- `SyncService`: owns inbound realtime and batch HCM balance ingestion.
- `HcmClientService`: owns outbound HCM fetch/consume/restore calls, error normalization, and audit logging.
- Prisma repositories: employees, balances, requests, sync logs, and HCM operation logs.
- SQLite-backed local state with a Prisma 7 `better-sqlite3` adapter.

### Core Design Decisions

- Local workflow state is authoritative for request status.
- HCM is authoritative for balance values.
- Request creation validates against a fresh-enough projection but does not reserve balance.
- Approval always performs authoritative HCM revalidation before consumption.
- Approved cancellation performs a compensating HCM restore.
- Batch and realtime syncs update projections and recompute `atRisk` warnings for pending requests.
- HCM write calls use deterministic idempotency keys derived from request id and operation.

## 5. Why This Design

### Alternative A: Strict synchronous coordinator

ReadyOn owns request status, but balance mutations are confirmed synchronously against HCM before final approval.  
Decision: chosen. It is the best fit for the challenge because it keeps the UX understandable, avoids hidden asynchronous reconciliation, and demonstrates defensive consistency clearly.

### Alternative B: Local reservation model

ReadyOn reserves balance locally at request creation and reconciles later with HCM.  
Rejected because it weakens the HCM-as-source-of-truth model and makes drift harder to reason about.

### Alternative C: Async outbox / eventual consistency

ReadyOn records approval intent locally and completes HCM consumption asynchronously.  
Rejected for this take-home because it adds operational complexity and weakens the “manager approves knowing the data is valid” requirement.

### REST vs GraphQL

REST was chosen because the challenge explicitly asks for “all necessary REST (or GraphQL) endpoints,” and the domain operations are command-heavy and explicit.

### SQLite vs PostgreSQL

SQLite is acceptable for the challenge and required by the prompt. PostgreSQL would be the production migration path for stronger concurrency controls and operational durability.

## 6. Data Model

- `Employee`
  - Local reference entity for ownership and role checks.
  - Fields: `id`, `name`, `email`, `role`, timestamps.
- `Balance`
  - Local HCM projection keyed by `(employeeId, locationId, leaveType)`.
  - Fields: `availableDays`, `lastSyncedAt`, `sourceUpdatedAt`, `version`, timestamps.
- `TimeOffRequest`
  - Workflow aggregate.
  - Fields: `startDate`, `endDate`, `durationDays`, `status`, `statusReason`, `notes`, `managerNotes`, `resolvedAt`, `resolvedBy`, `hcmTransactionId`, `atRisk`, timestamps.
- `SyncLog`
  - One row per inbound sync run.
- `HcmOperationLog`
  - One row per outbound HCM call, including idempotency metadata and normalized failures.

## 7. Main Flows

### Create request

1. Parse trusted actor headers.
2. Require employee ownership of the request.
3. Validate date range and inclusive calendar-day duration.
4. Reject overlapping `PENDING` or `APPROVED` requests.
5. Refresh the balance from HCM when the local projection is stale or missing.
6. Reject immediately on insufficient projected balance.
7. Persist as `PENDING`.

### Approve request

1. Require manager role.
2. Load the request and require `PENDING`.
3. Fetch the authoritative balance from HCM and upsert the local projection.
4. Reject if the authoritative balance is insufficient.
5. Call HCM `consume` with an idempotency key.
6. Upsert the returned balance projection.
7. Transition the request to `APPROVED` only after HCM success.

### Reject request

1. Require manager role.
2. Load the request and require `PENDING`.
3. Transition directly to `REJECTED`.

### Cancel request

1. Allow managers to cancel any request and employees to cancel only their own.
2. Require `PENDING` or `APPROVED`.
3. If `APPROVED`, call HCM `restore` with an idempotency key, then upsert the returned balance.
4. Transition the request to `CANCELLED`.

### Sync flows

- `POST /sync/realtime`: upsert a single balance projection and recompute `atRisk` for matching pending requests.
- `POST /sync/batch`: upsert a corpus of balances, skipping records older than the currently stored `sourceUpdatedAt`.

## 8. Public API

| Method  | Path                             | Purpose                            |
| ------- | -------------------------------- | ---------------------------------- |
| `GET`   | `/health`                        | Liveness check                     |
| `POST`  | `/time-off/requests`             | Submit a request                   |
| `GET`   | `/time-off/requests`             | List requests                      |
| `GET`   | `/time-off/requests/:id`         | Fetch one request                  |
| `PATCH` | `/time-off/requests/:id/approve` | Approve pending request            |
| `PATCH` | `/time-off/requests/:id/reject`  | Reject pending request             |
| `PATCH` | `/time-off/requests/:id/cancel`  | Cancel pending or approved request |
| `GET`   | `/balances`                      | Fetch current balance projection   |
| `POST`  | `/sync/realtime`                 | Ingest one HCM balance update      |
| `POST`  | `/sync/batch`                    | Ingest a batch HCM balance corpus  |

## 9. Error Contract

Error payload shape:

```json
{
  "statusCode": 422,
  "error": "INSUFFICIENT_BALANCE",
  "message": "Requested 3 days but only 2 remain."
}
```

Normalized codes:

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

## 10. Testing Strategy

### Unit tests

- Policy helpers: inclusive duration, stale balance detection, idempotency-key generation.
- Request service behavior: create, approve, reject, cancel, overlap rules, date validation.
- Balance service behavior: fresh vs stale projection handling.
- Sync service behavior: batch precedence and `atRisk` recomputation.

### Integration tests

- Real Nest dependency graph.
- Real Prisma repositories and SQLite.
- Injected HCM client mock for service-level behavior without HTTP.

### End-to-end tests

- HTTP request lifecycle against the real Nest app.
- Real mock HCM server with seed/reset/scenario controls.
- Happy path, approval path, approved cancellation path, and realtime `atRisk` path.

## 11. Requirement-to-Evidence Matrix

| Requirement                                   | Endpoint / Flow                   | Evidence                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Balance keyed by employee/location/leave type | balance projection and sync logic | [src/balances/application/balances.service.spec.ts](../src/balances/application/balances.service.spec.ts), [src/sync/application/sync.service.spec.ts](../src/sync/application/sync.service.spec.ts)                                                                                  |
| Reject invalid date ranges                    | create request                    | [src/time-off/application/requests.service.spec.ts](../src/time-off/application/requests.service.spec.ts)                                                                                                                                                                             |
| Reject overlapping requests                   | create request                    | [src/time-off/application/requests.service.spec.ts](../src/time-off/application/requests.service.spec.ts)                                                                                                                                                                             |
| Revalidate against HCM on approval            | approve request                   | [src/time-off/application/requests.service.approve.spec.ts](../src/time-off/application/requests.service.approve.spec.ts), [src/integration/requests.integration.spec.ts](../src/integration/requests.integration.spec.ts), [test/time-off.e2e-spec.ts](../test/time-off.e2e-spec.ts) |
| Keep request pending when HCM approval fails  | approve request                   | [src/time-off/application/requests.service.approve.spec.ts](../src/time-off/application/requests.service.approve.spec.ts), [src/integration/requests.integration.spec.ts](../src/integration/requests.integration.spec.ts)                                                            |
| Restore balance on approved cancellation      | cancel request                    | [src/time-off/application/requests.service.lifecycle.spec.ts](../src/time-off/application/requests.service.lifecycle.spec.ts), [test/time-off.e2e-spec.ts](../test/time-off.e2e-spec.ts)                                                                                              |
| Process batch and realtime syncs defensively  | sync flows                        | [src/sync/application/sync.service.spec.ts](../src/sync/application/sync.service.spec.ts), [test/time-off.e2e-spec.ts](../test/time-off.e2e-spec.ts)                                                                                                                                  |
| Mock HCM with realistic controls              | external dependency simulation    | [test/support/mock-hcm-server.ts](../test/support/mock-hcm-server.ts), [scripts/mock-hcm-server.js](../scripts/mock-hcm-server.js)                                                                                                                                                    |

## 12. Assumptions

- Authentication is out of scope; actor identity is provided by trusted headers.
- Any `MANAGER` may approve or reject any request.
- Duration is inclusive calendar days, not business days.
- Holiday calendars and partial-day rules are intentionally deferred.
- Sync endpoints are trusted integration endpoints, not public end-user endpoints.
- SQLite is sufficient for the take-home but is not the long-term concurrency target.

## 13. Trade-offs and Deferred Work

- The service relies on synchronous HCM confirmation for approvals and approved cancellations; this is simpler and safer for the take-home than eventual consistency.
- SQLite limits how far true concurrent-write guarantees can be demonstrated compared with PostgreSQL.
- The current implementation logs HCM operations and sync runs but does not yet expose a dedicated operator-facing audit API.
- Production hardening beyond the challenge would include stronger retry policies, backoff/circuit breaking, and explicit operational dashboards.
