# Time-Off Microservice Distributed Systems Audit

**Audit date:** April 24, 2026  
**Scope:** Deep validation of correctness, failure handling, idempotency, concurrency, and sync safety for the Time-Off Microservice.  
**System under review:** NestJS + TypeScript + SQLite, with an external HCM API as the authoritative balance source.

## Executive Verdict

The current implementation is **partially correct**, but it does **not** yet satisfy the hard guarantees required for a production-grade time-off workflow:

| Goal                                         | Verdict           | Why                                                                                                        |
| -------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| No invalid approvals                         | ❌ Not guaranteed | Two competing approvals can still over-consume when the HCM behaves non-defensively.                       |
| No balance corruption                        | ❌ Not guaranteed | Unknown-result writes and stale realtime syncs can diverge local state from HCM.                           |
| No double processing                         | ❌ Not guaranteed | Request creation has no idempotency, and approval can issue duplicate outbound consumes.                   |
| No inconsistency between HCM and local state | ❌ Not guaranteed | Approval/cancel races and ambiguous write timeouts can leave HCM changed while local state says otherwise. |

The current system **does** correctly handle the happy path and several explicit fail-closed paths, but there are still critical distributed-systems failures that can happen under concurrency, ambiguity, or stale data.

## Investigation Method

This audit was based on:

- Code-path tracing in:
  - `src/time-off/application/requests.service.ts`
  - `src/time-off/infrastructure/time-off-request.repository.ts`
  - `src/sync/application/sync.service.ts`
  - `src/hcm/hcm-client.service.ts`
  - `src/balances/infrastructure/balance.repository.ts`
  - `prisma/schema.prisma`
- Existing automated verification, re-run on April 24, 2026:
  - `npm test -- --runInBand` → `7` suites passed, `31` tests passed
  - `npm run test:integration` → `1` suite passed, `2` tests passed
  - `npm run test:e2e -- --runInBand test/time-off.e2e-spec.ts` → `1` suite passed, `3` tests passed
- Controlled, non-committed reproductions executed with `ts-node` to validate concurrency and ambiguity scenarios not currently covered by tests.

## Existing Verified Good Paths

These behaviors are already proven by the current test suite:

- Happy path create → approve → read balance:
  - `test/time-off.e2e-spec.ts:98-160`
  - `src/integration/requests.integration.spec.ts:100-162`
- Approval revalidates against HCM:
  - `src/time-off/application/requests.service.approve.spec.ts:242`
- Approval rejects when HCM reports lower authoritative balance:
  - `src/time-off/application/requests.service.approve.spec.ts:275`
- Approval fails closed when HCM is unavailable:
  - `src/time-off/application/requests.service.approve.spec.ts:306`
  - `src/integration/requests.integration.spec.ts:164-207`
- Create refreshes stale balance from HCM:
  - `src/time-off/application/requests.service.spec.ts:229`
- Batch freshness precedence and `atRisk` propagation:
  - `src/sync/application/sync.service.spec.ts:146-229`
- Approved cancellation restores balance through HCM:
  - `test/time-off.e2e-spec.ts:163-229`

## 1. Unit-Level Business Rules

### ✅ Safe Case

- **A request cannot be approved without revalidation in HCM.**
- Why it is safe:
  - `approveRequest()` always performs an authoritative HCM read before approval (`src/time-off/application/requests.service.ts:211-233`).
  - The returned balance is upserted locally before the duration check (`src/time-off/application/requests.service.ts:211-224`).
  - If the HCM read fails, the method throws before any request status transition happens.
- What guarantees correctness:
  - Mandatory remote read on every approval attempt.
  - Fail-closed error handling for HCM read failures.
  - Conditional local transition to `APPROVED` only after HCM `consume` returns successfully (`src/time-off/infrastructure/time-off-request.repository.ts:83-105`).

### ❌ Failure Case

- **A request can still be created when authoritative HCM balance is already insufficient.**
- Exact failure scenario:
  - Local projection says `10` days.
  - HCM has already dropped to `1` day because of an external adjustment.
  - The local projection is still within TTL.
  - Employee creates a `3`-day request.
  - The system persists `PENDING` even though authoritative balance is insufficient.
- Root cause:
  - `createRequest()` checks `getFreshBalance()` instead of always checking HCM (`src/time-off/application/requests.service.ts:153-167`).
  - `getFreshBalance()` returns the local projection whenever TTL has not expired (`src/time-off/application/requests.service.ts:365-395`).
  - That means creation authorization is based on cached state, not on the source of truth.
- Reproduction evidence:

```json
{
  "createdStatus": "PENDING",
  "hcmGetCalls": 0,
  "localCreatedCount": 1
}
```

- Code-level fix:
  - Change creation to always revalidate against HCM before persisting.
  - Keep cached balance for UI reads, but not for create authorization.

```ts
const authoritativeBalance = await this.dependencies.hcmClient.getBalance(
  employee.id,
  input.locationId,
  input.leaveType,
);

await this.dependencies.balances.upsert(authoritativeBalance);

if (authoritativeBalance.availableDays < durationDays) {
  throw new AppError('INSUFFICIENT_BALANCE', 422, ...);
}
```

- Architecture-level improvement:
  - Split the UX into:
    - cached balance preview for responsiveness
    - authoritative pre-commit validation for request creation
  - Never let the cache alone authorize persistence.

## 2. Integration Failures (API + DB + HCM)

### ✅ Safe Case

- **Happy-path integration is correct.**
- Why it is safe:
  - End-to-end tests prove batch sync, request creation, approval, and balance refresh (`test/time-off.e2e-spec.ts:98-160`).
  - Integration tests prove the real DB state is updated only after the injected HCM client returns success (`src/integration/requests.integration.spec.ts:100-162`).
- What guarantees correctness:
  - Request status is changed to `APPROVED` only after `consumeBalance()` returns (`src/time-off/application/requests.service.ts:226-252`).
  - When HCM is explicitly unavailable, the request remains `PENDING` (`src/integration/requests.integration.spec.ts:164-207`).

### ❌ Failure Case

- **A timeout after HCM has already applied the write can leave HCM and local state inconsistent.**
- Exact failure scenario:
  - Manager approves a pending request.
  - HCM applies the balance consumption.
  - The HTTP response times out before the service receives confirmation.
  - The service raises `HCM_RESULT_UNKNOWN`.
  - Local request remains `PENDING`, while HCM balance has already been reduced.
- Root cause:
  - `writeBalanceOperation()` performs a single `axios.post()` with no result-recovery flow (`src/hcm/hcm-client.service.ts:112-148`).
  - `normalizeError()` maps write timeouts to `HCM_RESULT_UNKNOWN`, but only logs the ambiguity; it does not reconcile it (`src/hcm/hcm-client.service.ts:195-245`).
  - `approveRequest()` has no intermediate state such as `APPROVAL_IN_PROGRESS`; it leaves the request as plain `PENDING` if the write result is ambiguous (`src/time-off/application/requests.service.ts:226-252`).
  - The same risk exists for approved cancellation because `cancelRequest()` calls `restoreBalance()` before the local status change (`src/time-off/application/requests.service.ts:325-352`).
- Reproduction evidence:

```json
{
  "errorCode": "HCM_RESULT_UNKNOWN",
  "authoritativeBalanceAfterConsume": 7,
  "localRequestStatus": "PENDING",
  "localBalanceWrites": 1
}
```

- Code-level fix:
  - Persist an outbound operation row before calling HCM.
  - Move the request into a transient state such as `APPROVAL_IN_PROGRESS`.
  - On `HCM_RESULT_UNKNOWN`, persist `UNKNOWN` and enqueue reconciliation instead of returning to plain `PENDING`.

```ts
await tx.timeOffRequest.update({
  where: { id: requestId, status: 'PENDING' },
  data: { status: 'APPROVAL_IN_PROGRESS' },
});

await tx.hcmOperationState.create({
  data: { idempotencyKey, requestId, operationType: 'CONSUME', status: 'PENDING' },
});

try {
  const result = await hcm.consumeBalance(...);
  // finalize APPROVED + mark operation SUCCESS
} catch (error) {
  if (error.code === 'HCM_RESULT_UNKNOWN') {
    // mark operation UNKNOWN + enqueue reconciliation
  }
  throw error;
}
```

- Architecture-level improvement:
  - Add a reconciliation worker for `UNKNOWN` operations.
  - Prefer an HCM contract that supports querying operation status by `idempotencyKey` or `transactionId`.
  - Do not add blind retries on writes unless they are paired with durable operation state and idempotent replay.

## 3. Inconsistency Scenarios

### ✅ Safe Case

- **Balance changes in HCM after request creation are revalidated at approval time.**
- Why it is safe:
  - Approval always calls `hcmClient.getBalance()` before consuming (`src/time-off/application/requests.service.ts:211-224`).
  - If HCM returns a lower balance than the request requires, approval is rejected and the request remains `PENDING`.
  - This path is covered by `src/time-off/application/requests.service.approve.spec.ts:275`.
- **Pending requests are marked `atRisk` when sync reduces available balance.**
- Why it is safe:
  - Both realtime and batch sync recompute `atRisk` for matching pending requests (`src/sync/application/sync.service.ts:57-70`, `73-109`, `134-148`).
  - This is covered by `src/sync/application/sync.service.spec.ts:146-172` and `test/time-off.e2e-spec.ts:231-287`.
- **There is an audit trail for outbound HCM calls and inbound sync runs.**
- What guarantees correctness:
  - `HcmOperationLog` and `SyncLog` persist operational history (`prisma/schema.prisma:102-130`).

### ❌ Failure Case

- **Malformed or inconsistent HCM payloads are trusted without semantic validation.**
- Exact failure scenario:
  - HCM returns `200 OK`, but the payload contains:
    - mismatched `employeeId`, `locationId`, or `leaveType`
    - negative `availableDays`
    - an unexpected or regressive timestamp
  - The microservice accepts that payload and upserts it into the local projection.
- Root cause:
  - `toBalanceProjection()` blindly maps response fields and assigns them to the local projection (`src/hcm/hcm-client.service.ts:164-179`).
  - `BalancesRepository.upsert()` persists whatever it receives without invariant checks (`src/balances/infrastructure/balance.repository.ts:31-58`).
  - There is no validation that the returned balance dimensions match the request that triggered the read/write.
- Code-level fix:
  - Add semantic validation before every balance upsert that originated from HCM.

```ts
function assertValidHcmBalance(
  expected: { employeeId: string; locationId: string; leaveType: LeaveType },
  payload: HcmBalanceResponse,
) {
  if (
    payload.employeeId !== expected.employeeId ||
    payload.locationId !== expected.locationId ||
    payload.leaveType !== expected.leaveType
  ) {
    throw new AppError(
      'HCM_WRITE_FAILED',
      502,
      'HCM returned mismatched dimensions.',
    );
  }

  if (payload.availableDays < 0) {
    throw new AppError(
      'HCM_WRITE_FAILED',
      502,
      'HCM returned a negative balance.',
    );
  }
}
```

- Architecture-level improvement:
  - Treat HCM payload validation as a boundary concern.
  - Add contract tests against malformed HCM responses.
  - Route malformed but successful HCM responses to a reconciliation / manual review queue instead of poisoning the cache.

## 4. Idempotency

### ✅ Safe Case

- **Repeated approval of the same request is safe only when HCM honors the idempotency key.**
- Why it is safe:
  - The service derives a deterministic idempotency key from request id and action (`src/shared/domain/time-off-policy.ts:35-40`).
  - The mock HCM server caches consume/restore results by idempotency key (`test/support/mock-hcm-server.ts:88-132`, `135-174`).
  - Local persistence updates the request only if it is still `PENDING` (`src/time-off/infrastructure/time-off-request.repository.ts:83-105`).
- Reproduction evidence:

```json
{
  "statuses": ["APPROVED", "REQUEST_NOT_PENDING"],
  "consumeCalls": ["time-off:req-1:consume:v1", "time-off:req-1:consume:v1"],
  "finalRequestStatus": "APPROVED"
}
```

- What guarantees correctness:
  - Deterministic idempotency key.
  - HCM-side idempotent replay.
  - Conditional local state transition from `PENDING`.

### ❌ Failure Case

- **Request creation is not idempotent, and approval is not locally exactly-once.**
- Exact failure scenario:
  - Same request submit is sent twice concurrently.
  - Both calls pass overlap check.
  - Both rows are inserted as `PENDING`.
- Root cause:
  - `TimeOffRequest` has no idempotency column or uniqueness contract for create (`prisma/schema.prisma:78-100`).
  - `createRequest()` does a read-check-insert sequence with no serialization (`src/time-off/application/requests.service.ts:136-182`).
  - `HcmOperationLog` is append-only and has no uniqueness on `idempotencyKey` (`prisma/schema.prisma:113-130`, `src/audit/infrastructure/hcm-operation-log.repository.ts:9-36`).
  - Approval will send duplicate outbound `consume` requests for the same business action if the endpoint is retried, even though the HCM mock protects the balance.
- Reproduction evidence:

```json
{
  "statuses": ["fulfilled", "fulfilled"],
  "createdCount": 2,
  "requestStatuses": ["PENDING", "PENDING"]
}
```

- Code-level fix:
  - Add `Idempotency-Key` support to `POST /time-off/requests`.
  - Persist it with a unique constraint and replay the original response on retry.
  - Persist approval/cancel operations in a dedicated state table with unique `idempotencyKey`; if the operation is already `SUCCESS`, return the existing result instead of calling HCM again.

```prisma
model RequestIdempotency {
  idempotencyKey String @id
  requestId      String
  responseBody   String
  createdAt      DateTime @default(now())
}
```

- Architecture-level improvement:
  - Centralize idempotency handling across write endpoints.
  - Make create, approve, and cancel externally idempotent independently of HCM behavior.

## 5. Concurrency

### ✅ Safe Case

- **There is a narrow safe case for double approval of the same request when HCM honors idempotency.**
- Why it is safe:
  - Duplicate approval attempts use the same deterministic idempotency key.
  - Only one local update from `PENDING` to `APPROVED` can succeed (`src/time-off/infrastructure/time-off-request.repository.ts:83-105`).
- What guarantees correctness:
  - HCM-side idempotent replay.
  - Conditional local state transition from `PENDING`.

### ❌ Failure Case

- **Concurrent creation of overlapping requests is unsafe.**
- Exact failure scenario:
  - Two concurrent create requests for the same employee, location, leave type, and date range arrive at the same time.
  - Both evaluate overlap before either inserts.
  - Both persist.
- Root cause:
  - `createRequest()` performs overlap read and insert separately, with no lock or unique constraint (`src/time-off/application/requests.service.ts:136-182`).
  - `TimeOffRequest` has only an index on date dimensions, not a uniqueness or exclusion constraint (`prisma/schema.prisma:98-99`).
- Reproduction evidence:

```json
{
  "statuses": ["fulfilled", "fulfilled"],
  "createdCount": 2,
  "requestStatuses": ["PENDING", "PENDING"]
}
```

- **Concurrent approvals for the same balance dimension are unsafe when HCM is non-defensive.**
- Exact failure scenario:
  - Two different pending requests for the same `(employeeId, locationId, leaveType)` are approved concurrently.
  - Both fetch authoritative balance before either consume completes.
  - Both consume successfully.
  - Final authoritative balance becomes negative.
- Root cause:
  - Approval has no local serialization by balance dimension.
  - `Balance.version` exists in the schema but is never used in a compare-and-swap update (`prisma/schema.prisma:61-76`, `src/balances/infrastructure/balance.repository.ts:31-55`).
  - HCM reads always reset local `version` to `1`, which makes the field unusable even as a future concurrency guard (`src/hcm/hcm-client.service.ts:164-179`).
- Reproduction evidence:

```json
{
  "statuses": ["fulfilled", "fulfilled"],
  "requestStates": ["APPROVED", "APPROVED"],
  "authoritativeBalance": -4,
  "hcmCalls": [
    {
      "requestId": "req-1",
      "remaining": 3
    },
    {
      "requestId": "req-2",
      "remaining": -4
    }
  ]
}
```

- **Approval and cancellation of the same pending request can race into inconsistent state.**
- Exact failure scenario:
  - Manager starts approving a `PENDING` request.
  - Before local approval transition happens, the employee cancels the same `PENDING` request.
  - Approval has already consumed HCM.
  - Local request ends as `CANCELLED`, but HCM balance is reduced.
- Root cause:
  - `approveRequest()` performs HCM `consume` before the local request transition (`src/time-off/application/requests.service.ts:226-242`).
  - `cancelRequest()` allows `PENDING` cancellation with no coordination against in-flight approval (`src/time-off/application/requests.service.ts:299-352`).
  - There is no transient `PROCESSING` state or lease that blocks conflicting operations.
- Reproduction evidence:

```json
{
  "cancelStatus": "CANCELLED",
  "approveErrorCode": "REQUEST_NOT_PENDING",
  "finalRequestStatus": "CANCELLED",
  "authoritativeBalance": 7
}
```

- Code-level fix:
  - Introduce transient states such as:
    - `APPROVAL_IN_PROGRESS`
    - `CANCELLATION_IN_PROGRESS`
  - Move the request into the transient state with a conditional update **before** any HCM side effect.
  - Add per-dimension serialization for create/approve/cancel, for example with a `BalanceDimensionLease` table keyed by `(employeeId, locationId, leaveType)`.

```prisma
model BalanceDimensionLease {
  employeeId String
  locationId String
  leaveType  LeaveType
  holderId   String
  expiresAt  DateTime

  @@id([employeeId, locationId, leaveType])
}
```

- Architecture-level improvement:
  - In production, move this workflow to PostgreSQL and use advisory locks or row-level locking.
  - If workflow throughput grows, model balance consumption as an internal reservation ledger instead of a pure read-check-write sequence.

## 6. Sync (Batch + Realtime)

### ✅ Safe Case

- **Batch sync correctly avoids overwriting a fresher local projection.**
- Why it is safe:
  - `syncBatch()` skips incoming records when local `sourceUpdatedAt` is newer (`src/sync/application/sync.service.ts:80-98`).
  - This behavior is covered by `src/sync/application/sync.service.spec.ts:175-201`.
- **Sync recalculates `atRisk` after balance changes.**
- Why it is safe:
  - `updateAtRiskFlags()` is called after both realtime and batch upserts (`src/sync/application/sync.service.ts:61-69`, `95-97`, `134-148`).
- What guarantees correctness:
  - Freshness check in batch.
  - `atRisk` recomputation on matching pending requests.

### ❌ Failure Case

- **Realtime sync can overwrite a fresher balance with stale data.**
- Exact failure scenario:
  - Local balance has `sourceUpdatedAt = 00:10`.
  - HCM sends a realtime payload with `sourceUpdatedAt = 00:05`.
  - `syncRealtime()` overwrites the projection anyway.
- Root cause:
  - `syncRealtime()` directly calls `upsertIncomingBalance()` with no freshness guard (`src/sync/application/sync.service.ts:57-70`).
  - Only batch sync performs stale-payload rejection (`src/sync/application/sync.service.ts:80-93`).
- Reproduction evidence:

```json
{
  "finalAvailableDays": 4,
  "finalSourceUpdatedAt": "2026-04-24T00:05:00.000Z",
  "overwriteHappened": true
}
```

- **Batch sync does not support real partial-failure accounting.**
- Exact failure scenario:
  - One record in a batch fails validation or persistence.
  - The entire loop throws.
  - The API does not return accurate `processed / failed / skipped` counts.
  - `SyncLog` still has only a coarse success path in the current implementation.
- Root cause:
  - `syncBatch()` has no per-record try/catch and always returns `failed: 0` (`src/sync/application/sync.service.ts:73-109`).
- Code-level fix:
  - Apply the same freshness guard to realtime as batch.
  - Process batch records independently and return real counts.

```ts
if (
  existing?.sourceUpdatedAt &&
  existing.sourceUpdatedAt.getTime() > input.sourceUpdatedAt.getTime()
) {
  return { skipped: true };
}
```

```ts
let processed = 0;
let failed = 0;
let skipped = 0;

for (const balance of input.balances) {
  try {
    // validate, freshness-check, upsert
    processed += 1;
  } catch (error) {
    failed += 1;
    errors.push(...);
  }
}
```

- Architecture-level improvement:
  - Prefer HCM sync payloads with monotonic sequence numbers or revision ids.
  - Treat sync as an append-only ingest stream rather than blind projection replacement.

## Prioritized Remediation Backlog

### Critical

- Always revalidate with HCM before request creation.
- Add transient request states for in-flight approval and cancellation.
- Persist HCM operation state with unique idempotency keys and reconcile `UNKNOWN` writes.
- Serialize create/approve/cancel per `(employeeId, locationId, leaveType)`.
- Add realtime freshness guard.

### High

- Add request creation idempotency (`Idempotency-Key`).
- Validate HCM response dimensions, timestamps, and non-negative balances before local upsert.
- Add partial-failure accounting and `PARTIAL` / `FAILED` sync logs for batch ingest.
- Stop treating `Balance.version` as meaningful until compare-and-swap semantics are actually implemented.

### Hardening

- Migrate from SQLite to PostgreSQL for stronger locking primitives and operational durability.
- Add alerting for:
  - `HCM_RESULT_UNKNOWN`
  - stale `APPROVAL_IN_PROGRESS` / `CANCELLATION_IN_PROGRESS`
  - repeated sync overwrite attempts
  - repeated `atRisk` requests
- Extend the mock HCM to simulate:
  - delayed 200-after-timeout semantics
  - malformed success payloads
  - duplicate delivery and out-of-order sync events

## Tests That Must Be Added Before Calling The System Safe

- Create request with fresh local cache but lower authoritative HCM balance.
- Concurrent duplicate create for the same employee/location/date range.
- Concurrent approve + cancel on the same pending request.
- Concurrent approvals of two requests against the same balance dimension.
- Approval write timeout after HCM has already consumed balance.
- Cancellation write timeout after HCM has already restored balance.
- Realtime sync with stale `sourceUpdatedAt`.
- Batch sync with mixed valid and invalid records.
- Malformed HCM success payloads with mismatched dimensions or negative balance.

## Final Assessment

The current implementation is **good enough as a challenge prototype**, but it is **not yet safe enough to claim strong distributed-systems correctness**. The major remaining problems are not cosmetic. They are correctness bugs:

- stale cached authorization on create
- missing exactly-once semantics for create and outbound HCM writes
- missing reconciliation for ambiguous HCM write results
- missing serialization of conflicting operations
- stale realtime overwrite

Until those are fixed, the system cannot honestly guarantee:

- no invalid approvals
- no balance corruption
- no double processing
- no inconsistency between HCM and local state
