require('dotenv/config');

const { randomUUID } = require('crypto');
const express = require('express');

const port = Number(process.env.HCM_PORT ?? 4010);

const balances = new Map();
const calls = [];
const idempotencyResults = new Map();
const scenarios = new Map([
  ['all', 'none'],
  ['get', 'none'],
  ['consume', 'none'],
  ['restore', 'none'],
]);

function balanceKey(employeeId, locationId, leaveType) {
  return `${employeeId}:${locationId}:${leaveType}`;
}

function activeScenario(operation) {
  const scoped = scenarios.get(operation) ?? 'none';
  if (scoped !== 'none') {
    return scoped;
  }

  return scenarios.get('all') ?? 'none';
}

function failForScenario(res, scenario) {
  switch (scenario) {
    case 'insufficient_balance':
      return res.status(422).json({ message: 'Insufficient balance.' });
    case 'invalid_dimensions':
      return res.status(400).json({
        message: 'Invalid employee/location/leave type combination.',
      });
    case 'unavailable':
      return res.status(503).json({ message: 'HCM unavailable.' });
    default:
      return false;
  }
}

const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  calls.push({
    method: req.method,
    path: req.path,
    body: req.body,
  });
  next();
});

app.get('/mock/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    port,
  });
});

app.get('/balances/:employeeId/:locationId/:leaveType', (req, res) => {
  const scenario = activeScenario('get');
  if (scenario !== 'none') {
    return failForScenario(res, scenario);
  }

  const key = balanceKey(
    req.params.employeeId,
    req.params.locationId,
    req.params.leaveType,
  );
  const balance = balances.get(key);

  if (!balance) {
    return res.status(400).json({
      message: 'Invalid employee/location/leave type combination.',
    });
  }

  return res.status(200).json(balance);
});

app.post('/balances/consume', (req, res) => {
  const scenario = activeScenario('consume');
  if (scenario !== 'none') {
    return failForScenario(res, scenario);
  }

  const { employeeId, locationId, leaveType, days, idempotencyKey } = req.body;

  if (idempotencyResults.has(idempotencyKey)) {
    return res.status(200).json(idempotencyResults.get(idempotencyKey));
  }

  const key = balanceKey(employeeId, locationId, leaveType);
  const balance = balances.get(key);
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

  const updated = {
    ...balance,
    availableDays: balance.availableDays - days,
    sourceUpdatedAt: new Date().toISOString(),
  };
  balances.set(key, updated);

  const response = {
    transactionId: randomUUID(),
    balance: updated,
  };
  idempotencyResults.set(idempotencyKey, response);
  return res.status(200).json(response);
});

app.post('/balances/restore', (req, res) => {
  const scenario = activeScenario('restore');
  if (scenario !== 'none') {
    return failForScenario(res, scenario);
  }

  const { employeeId, locationId, leaveType, days, idempotencyKey } = req.body;

  if (idempotencyResults.has(idempotencyKey)) {
    return res.status(200).json(idempotencyResults.get(idempotencyKey));
  }

  const key = balanceKey(employeeId, locationId, leaveType);
  const balance = balances.get(key);
  if (!balance) {
    return res.status(400).json({
      message: 'Invalid employee/location/leave type combination.',
    });
  }

  const updated = {
    ...balance,
    availableDays: balance.availableDays + days,
    sourceUpdatedAt: new Date().toISOString(),
  };
  balances.set(key, updated);

  const response = {
    transactionId: randomUUID(),
    balance: updated,
  };
  idempotencyResults.set(idempotencyKey, response);
  return res.status(200).json(response);
});

app.post('/mock/seed-balance', (req, res) => {
  const balance = req.body;
  balances.set(
    balanceKey(balance.employeeId, balance.locationId, balance.leaveType),
    balance,
  );
  return res.status(200).json({ seeded: true });
});

app.post('/mock/set-scenario', (req, res) => {
  const { operation = 'all', scenario = 'none' } = req.body;
  scenarios.set(operation, scenario);
  return res.status(200).json({ updated: true });
});

app.post('/mock/reset', (_req, res) => {
  balances.clear();
  calls.length = 0;
  idempotencyResults.clear();
  scenarios.set('all', 'none');
  scenarios.set('get', 'none');
  scenarios.set('consume', 'none');
  scenarios.set('restore', 'none');
  return res.status(200).json({ reset: true });
});

app.get('/mock/calls', (_req, res) => {
  return res.status(200).json({ calls });
});

app.get('/mock/state', (_req, res) => {
  return res.status(200).json({
    balances: [...balances.values()],
    scenarios: Object.fromEntries(scenarios.entries()),
    callCount: calls.length,
  });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`Mock HCM server listening on http://127.0.0.1:${port}`);
});
