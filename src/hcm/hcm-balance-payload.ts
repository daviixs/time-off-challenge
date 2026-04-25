import { AppError } from '../common/errors/app-error';
import { type LeaveType } from '../time-off/domain/time-off.types';

type ExpectedDimension = {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
};

type RawBalancePayload = {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  availableDays: number;
  sourceUpdatedAt?: string | Date | null;
};

export type ValidatedBalancePayload = {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  availableDays: number;
  sourceUpdatedAt: Date;
};

export function validateHcmBalancePayload(
  payload: RawBalancePayload,
  expected?: ExpectedDimension,
): ValidatedBalancePayload {
  if (expected) {
    if (
      payload.employeeId !== expected.employeeId ||
      payload.locationId !== expected.locationId ||
      payload.leaveType !== expected.leaveType
    ) {
      throw new AppError(
        'INVALID_HCM_PAYLOAD',
        502,
        'HCM returned balance data for unexpected dimensions.',
      );
    }
  }

  if (
    typeof payload.availableDays !== 'number' ||
    Number.isNaN(payload.availableDays) ||
    payload.availableDays < 0
  ) {
    throw new AppError(
      'INVALID_HCM_PAYLOAD',
      502,
      'HCM returned an invalid available balance.',
    );
  }

  const sourceUpdatedAt = parseSourceUpdatedAt(payload.sourceUpdatedAt);

  return {
    employeeId: payload.employeeId,
    locationId: payload.locationId,
    leaveType: payload.leaveType,
    availableDays: payload.availableDays,
    sourceUpdatedAt,
  };
}

function parseSourceUpdatedAt(value: string | Date | null | undefined): Date {
  if (!value) {
    throw new AppError(
      'INVALID_HCM_PAYLOAD',
      502,
      'HCM returned a balance without a valid sourceUpdatedAt.',
    );
  }

  const parsed = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(
      'INVALID_HCM_PAYLOAD',
      502,
      'HCM returned a balance without a valid sourceUpdatedAt.',
    );
  }

  return parsed;
}
