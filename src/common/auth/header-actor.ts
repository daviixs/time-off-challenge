import { AppError } from '../errors/app-error';
import { type Actor, Role } from '../../time-off/domain/time-off.types';

export function actorFromHeaders(input: {
  userId?: string;
  role?: string;
}): Actor {
  if (!input.userId || !input.role) {
    throw new AppError(
      'UNAUTHENTICATED',
      401,
      'Missing required authentication headers.',
    );
  }

  const role = input.role as Role;

  if (!Object.values(Role).includes(role)) {
    throw new AppError('FORBIDDEN_ROLE', 403, 'Unsupported actor role.');
  }

  return {
    userId: input.userId,
    role,
  };
}
