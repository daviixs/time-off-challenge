# Test Evidence

## Verification Commands

Latest local verification sequence:

```bash
npm run lint
npm run build
npm test -- --runInBand
npm run test:integration
npm run test:e2e -- --runInBand
npm run test:cov -- --runInBand
```

## Latest Results

- `npm run lint`: pass
- `npm run build`: pass
- `npm test -- --runInBand`: pass
- `npm run test:integration`: pass
- `npm run test:e2e -- --runInBand`: pass
- `npm run test:cov -- --runInBand`: pass

## Coverage Snapshot

Coverage from the latest local run:

| File                                           | Statements | Branches | Functions |    Lines |
| ---------------------------------------------- | ---------: | -------: | --------: | -------: |
| All files                                      |   `93.62%` | `83.12%` |  `95.12%` | `93.24%` |
| `src/hcm`                                      |   `98.59%` |  `87.5%` |    `100%` | `98.55%` |
| `src/hcm/hcm-client.service.ts`                |     `100%` | `84.21%` |    `100%` |   `100%` |
| `src/sync/application/sync.service.ts`         |     `100%` |   `100%` |    `100%` |   `100%` |
| `src/time-off/application`                     |   `87.86%` | `80.75%` |    `100%` | `87.76%` |
| `src/time-off/application/requests.service.ts` |   `86.93%` | `79.59%` |    `100%` | `86.93%` |
| `src/time-off/infrastructure`                  |     `100%` | `94.73%` |    `100%` |   `100%` |

Branch coverage increased from approximately `52.7%` to `83.12%`, within the target range of `80-85%`.

<details>
<summary>Raw coverage output</summary>

```text
> time-off-challenge@0.0.1 test:cov
> jest --coverage --runInBand

----------------------------------------|---------|----------|---------|---------|--------------------------------------------------------------------------------------------------------
File                                    | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------------------------|---------|----------|---------|---------|--------------------------------------------------------------------------------------------------------
All files                               |   93.62 |    83.12 |   95.12 |   93.24 |
 src/hcm                                |   98.59 |     87.5 |     100 |   98.55 |
  hcm-client.service.ts                 |     100 |    84.21 |     100 |     100 | 32-35,269,275-281
 src/sync/application                   |     100 |      100 |     100 |     100 |
  sync.service.ts                       |     100 |      100 |     100 |     100 |
 src/time-off/application               |   87.86 |    80.75 |     100 |   87.76 |
  requests.service.ts                   |   86.93 |    79.59 |     100 |   86.93 | 240,376,420,441,450-451,501,546,555,562,573,581,596,636,671,702,724,733-734,768,946-951,1015-1020,1112
 src/time-off/infrastructure            |     100 |    94.73 |     100 |     100 |
  request-idempotency.repository.ts     |     100 |    91.66 |     100 |     100 | 15
  time-off-request.repository.ts        |     100 |    96.15 |     100 |     100 | 29
----------------------------------------|---------|----------|---------|---------|--------------------------------------------------------------------------------------------------------

Test Suites: 19 passed, 19 total
Tests:       156 passed, 156 total
Snapshots:   0 total
Time:        2.025 s
Ran all test suites.
```

</details>

## High-Value Test Areas

- Pure policy validation:
  [src/shared/domain/time-off-policy.spec.ts](../src/shared/domain/time-off-policy.spec.ts)
- Request creation rules:
  [src/time-off/application/requests.service.spec.ts](../src/time-off/application/requests.service.spec.ts)
- Approval safety and HCM defensive behavior:
  [src/time-off/application/requests.service.approve.spec.ts](../src/time-off/application/requests.service.approve.spec.ts)
- Reject/cancel lifecycle:
  [src/time-off/application/requests.service.lifecycle.spec.ts](../src/time-off/application/requests.service.lifecycle.spec.ts)
- Balance freshness and authoritative refresh:
  [src/balances/application/balances.service.spec.ts](../src/balances/application/balances.service.spec.ts)
- Batch/realtime sync precedence and `atRisk` propagation:
  [src/sync/application/sync.service.spec.ts](../src/sync/application/sync.service.spec.ts)
- HCM semantic payload validation:
  [src/hcm/hcm-client.service.spec.ts](../src/hcm/hcm-client.service.spec.ts)
- HCM operation replay/idempotency:
  [src/hcm/infrastructure/hcm-operation.repository.spec.ts](../src/hcm/infrastructure/hcm-operation.repository.spec.ts)
- Balance-dimension lease serialization:
  [src/balances/infrastructure/balance-dimension-lease.repository.spec.ts](../src/balances/infrastructure/balance-dimension-lease.repository.spec.ts)
- Request idempotency persistence:
  [src/time-off/infrastructure/request-idempotency.repository.spec.ts](../src/time-off/infrastructure/request-idempotency.repository.spec.ts)
- Real Nest + Prisma integration:
  [src/integration/requests.integration.spec.ts](../src/integration/requests.integration.spec.ts)
- Full HTTP flow with mock HCM:
  [test/time-off.e2e-spec.ts](../test/time-off.e2e-spec.ts)

## Critical Branches Added

- HCM client success/error branches: 500, timeout, ambiguous write, insufficient balance, invalid dimension, negative balance, invalid `sourceUpdatedAt`, and mismatched dimensions.
- Request approval branches: insufficient authoritative balance, HCM unavailable, HCM result unknown, non-`PENDING` request, existing `SUCCESS`/`UNKNOWN`/`PENDING` operation, retry from `FAILED`, and occupied dimension lease.
- Cancellation branches: local `PENDING` cancel, approved restore success, restore failure, restore ambiguity to `CANCELLATION_UNKNOWN`, already terminal states, missing request, and occupied lease.
- Sync branches: stale realtime event skipped, fresher event applied, batch with multiple balances, stale batch payload ignored, invalid payload rejected without overwrite, and `atRisk` true/false propagation.
- Idempotency/concurrency branches: duplicate create with same key, same key with different payload, pending idempotency row, create failure cleanup, HCM replay safety, and simultaneous approval serialization.

## Remaining Coverage Gaps

The remaining gaps are intentionally lower-value or operational bootstrap paths:

- [src/main.ts](../src/main.ts), because app bootstrap is not covered by unit tests.
- [src/app.module.ts](../src/app.module.ts), because branch gaps are environment/provider wiring.
- Some DTO decorator metadata branches generated by validation decorators.
- A small number of rare fallback branches in [src/time-off/application/requests.service.ts](../src/time-off/application/requests.service.ts), mostly around defensive reconciliation paths.

Those are acceptable for the take-home because the critical HCM, workflow, sync, idempotency, and concurrency paths are now covered by behavior-oriented tests rather than implementation-only assertions.
