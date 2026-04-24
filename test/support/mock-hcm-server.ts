/* eslint-disable @typescript-eslint/require-await */

import { randomUUID } from 'crypto';
import express, { type Express } from 'express';
import { createServer, type Server } from 'http';

type LeaveType = 'VACATION' | 'SICK' | 'PERSONAL';

type BalanceRecord = {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  availableDays: number;
  sourceUpdatedAt: string;
};

type ScenarioName =
  | 'none'
  | 'insufficient_balance'
  | 'invalid_dimensions'
  | 'unavailable';

type OperationName = 'get' | 'consume' | 'restore' | 'all';

type MockState = {
  balances: Map<string, BalanceRecord>;
  scenarios: Map<OperationName, ScenarioName>;
  idempotencyResults: Map<
    string,
    {
      transactionId: string;
      balance: BalanceRecord;
    }
  >;
  calls: Array<{
    method: string;
    path: string;
    body?: unknown;
  }>;
};

export type MockHcmServer = {
  baseUrl: string;
  close(): Promise<void>;
  reset(): Promise<void>;
  seedBalance(balance: BalanceRecord): Promise<void>;
  setScenario(operation: OperationName, scenario: ScenarioName): Promise<void>;
  getCalls(): Promise<Array<{ method: string; path: string; body?: unknown }>>;
};

function balanceKey(input: {
  employeeId: string;
  locationId: string;
  leaveType: string;
}): string {
  return `${input.employeeId}:${input.locationId}:${input.leaveType}`;
}

function createApp(state: MockState): Express {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    state.calls.push({
      method: req.method,
      path: req.path,
      body: req.body,
    });
    next();
  });

  app.get('/balances/:employeeId/:locationId/:leaveType', (req, res) => {
    if (shouldFail(state, 'get')) {
      return failForScenario(state, 'get', res);
    }

    const key = balanceKey(req.params);
    const balance = state.balances.get(key);
    if (!balance) {
      return res.status(400).json({
        message: 'Invalid employee/location/leave type combination.',
      });
    }

    return res.status(200).json(balance);
  });

  app.post('/balances/consume', (req, res) => {
    if (shouldFail(state, 'consume')) {
      return failForScenario(state, 'consume', res);
    }

    const { employeeId, locationId, leaveType, days, idempotencyKey } =
      req.body as {
        employeeId: string;
        locationId: string;
        leaveType: LeaveType;
        days: number;
        idempotencyKey: string;
      };

    if (state.idempotencyResults.has(idempotencyKey)) {
      return res.status(200).json(state.idempotencyResults.get(idempotencyKey));
    }

    const key = balanceKey({ employeeId, locationId, leaveType });
    const balance = state.balances.get(key);
    if (!balance) {
      return res.status(400).json({
        message: 'Invalid employee/location/leave type combination.',
      });
    }

    if (balance.availableDays < days) {
      return res.status(422).json({
        message: `Requested ${days} days but only ${balance.availableDays} remain.`,
      });
    }

    const updated: BalanceRecord = {
      ...balance,
      availableDays: balance.availableDays - days,
      sourceUpdatedAt: new Date().toISOString(),
    };
    state.balances.set(key, updated);

    const response = {
      transactionId: randomUUID(),
      balance: updated,
    };
    state.idempotencyResults.set(idempotencyKey, response);
    return res.status(200).json(response);
  });

  app.post('/balances/restore', (req, res) => {
    if (shouldFail(state, 'restore')) {
      return failForScenario(state, 'restore', res);
    }

    const { employeeId, locationId, leaveType, days, idempotencyKey } =
      req.body as {
        employeeId: string;
        locationId: string;
        leaveType: LeaveType;
        days: number;
        idempotencyKey: string;
      };

    if (state.idempotencyResults.has(idempotencyKey)) {
      return res.status(200).json(state.idempotencyResults.get(idempotencyKey));
    }

    const key = balanceKey({ employeeId, locationId, leaveType });
    const balance = state.balances.get(key);
    if (!balance) {
      return res.status(400).json({
        message: 'Invalid employee/location/leave type combination.',
      });
    }

    const updated: BalanceRecord = {
      ...balance,
      availableDays: balance.availableDays + days,
      sourceUpdatedAt: new Date().toISOString(),
    };
    state.balances.set(key, updated);

    const response = {
      transactionId: randomUUID(),
      balance: updated,
    };
    state.idempotencyResults.set(idempotencyKey, response);
    return res.status(200).json(response);
  });

  app.post('/mock/seed-balance', (req, res) => {
    const balance = req.body as BalanceRecord;
    state.balances.set(balanceKey(balance), balance);
    return res.status(200).json({ seeded: true });
  });

  app.post('/mock/set-scenario', (req, res) => {
    const { operation = 'all', scenario = 'none' } = req.body as {
      operation?: OperationName;
      scenario?: ScenarioName;
    };
    state.scenarios.set(operation, scenario);
    return res.status(200).json({ updated: true });
  });

  app.post('/mock/reset', (_req, res) => {
    state.balances.clear();
    state.calls.length = 0;
    state.idempotencyResults.clear();
    state.scenarios.set('all', 'none');
    state.scenarios.set('get', 'none');
    state.scenarios.set('consume', 'none');
    state.scenarios.set('restore', 'none');
    return res.status(200).json({ reset: true });
  });

  app.get('/mock/calls', (_req, res) => {
    return res.status(200).json({ calls: state.calls });
  });

  return app;
}

function shouldFail(state: MockState, operation: OperationName): boolean {
  return (
    (state.scenarios.get(operation) ?? 'none') !== 'none' ||
    (state.scenarios.get('all') ?? 'none') !== 'none'
  );
}

function failForScenario(
  state: MockState,
  operation: OperationName,
  res: express.Response,
) {
  const scenario =
    state.scenarios.get(operation) === 'none'
      ? (state.scenarios.get('all') ?? 'none')
      : (state.scenarios.get(operation) ?? 'none');

  switch (scenario) {
    case 'insufficient_balance':
      return res.status(422).json({ message: 'Insufficient balance.' });
    case 'invalid_dimensions':
      return res
        .status(400)
        .json({ message: 'Invalid employee/location/leave type combination.' });
    case 'unavailable':
      return res.status(503).json({ message: 'HCM unavailable.' });
    default:
      return res.status(500).json({ message: 'Unhandled mock scenario.' });
  }
}

export async function startMockHcmServer(): Promise<MockHcmServer> {
  const state: MockState = {
    balances: new Map(),
    scenarios: new Map([
      ['all', 'none'],
      ['get', 'none'],
      ['consume', 'none'],
      ['restore', 'none'],
    ]),
    idempotencyResults: new Map(),
    calls: [],
  };

  const app = createApp(state);
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock HCM server failed to bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await closeServer(server);
    },
    async reset() {
      state.balances.clear();
      state.calls.length = 0;
      state.idempotencyResults.clear();
      state.scenarios.set('all', 'none');
      state.scenarios.set('get', 'none');
      state.scenarios.set('consume', 'none');
      state.scenarios.set('restore', 'none');
    },
    async seedBalance(balance: BalanceRecord) {
      state.balances.set(balanceKey(balance), balance);
    },
    async setScenario(operation: OperationName, scenario: ScenarioName) {
      state.scenarios.set(operation, scenario);
    },
    async getCalls() {
      return state.calls;
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
