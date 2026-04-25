# Test Evidence

## Verification Commands
Latest local verification sequence:

```bash
npm run lint
npm run build
npm test -- --runInBand
npm run test:integration
npm run test:e2e -- --runInBand test/time-off.e2e-spec.ts
npm run test:cov -- --runInBand
```

## Latest Results
- `npm run lint`: pass
- `npm run build`: pass
- `npm test -- --runInBand`: pass
- `npm run test:integration`: pass
- `npm run test:e2e -- --runInBand test/time-off.e2e-spec.ts`: pass
- `npm run test:cov -- --runInBand`: pass

## Coverage Snapshot
Coverage from the latest local run:

| Metric | Value |
| --- | --- |
| Statements | `70.63%` |
| Branches | `52.7%` |
| Functions | `63.41%` |
| Lines | `69.6%` |

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
- Real Nest + Prisma integration:
  [src/integration/requests.integration.spec.ts](../src/integration/requests.integration.spec.ts)
- Full HTTP flow with mock HCM:
  [test/time-off.e2e-spec.ts](../test/time-off.e2e-spec.ts)

## Remaining Coverage Gaps
The lowest-covered areas are infrastructure-heavy code paths that are exercised mostly through e2e rather than exhaustive branch tests:
- [src/hcm/hcm-client.service.ts](../src/hcm/hcm-client.service.ts)
- [src/common/errors/app-exception.filter.ts](../src/common/errors/app-exception.filter.ts)
- [src/time-off/infrastructure/time-off-request.repository.ts](../src/time-off/infrastructure/time-off-request.repository.ts)

Those are acceptable for the take-home, but would be the next targets if the submission were extended.
