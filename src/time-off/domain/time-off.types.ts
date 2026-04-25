export enum Role {
  EMPLOYEE = 'EMPLOYEE',
  MANAGER = 'MANAGER',
}

export enum LeaveType {
  VACATION = 'VACATION',
  SICK = 'SICK',
  PERSONAL = 'PERSONAL',
}

export type Employee = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
};

export type BalanceProjection = {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  availableDays: number;
  lastSyncedAt: Date;
  sourceUpdatedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TimeOffRequestStatus =
  | 'PENDING'
  | 'APPROVAL_IN_PROGRESS'
  | 'APPROVAL_UNKNOWN'
  | 'APPROVED'
  | 'CANCELLATION_IN_PROGRESS'
  | 'CANCELLATION_UNKNOWN'
  | 'REJECTED'
  | 'CANCELLED';

export type TimeOffRequest = {
  id: string;
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  status: TimeOffRequestStatus;
  statusReason: string | null;
  notes: string | null;
  managerNotes: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  hcmTransactionId: string | null;
  atRisk: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateTimeOffRequestInput = {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  notes?: string;
};

export type Actor = {
  userId: string;
  role: Role;
};
