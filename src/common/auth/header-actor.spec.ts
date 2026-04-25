import { actorFromHeaders } from './header-actor';
import { AppError } from '../errors/app-error';
import { Role } from '../../time-off/domain/time-off.types';

describe('actorFromHeaders', () => {
  function expectAppError(
    callback: () => unknown,
    expected: Pick<AppError, 'code' | 'statusCode'>,
  ) {
    try {
      callback();
      throw new Error('Expected callback to throw AppError.');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject(expected);
    }
  }

  it('returns an actor when required headers are valid', () => {
    expect(
      actorFromHeaders({ userId: 'emp-001', role: Role.EMPLOYEE }),
    ).toEqual({
      userId: 'emp-001',
      role: Role.EMPLOYEE,
    });
  });

  it('rejects missing authentication headers', () => {
    expectAppError(
      () => actorFromHeaders({ userId: undefined, role: Role.EMPLOYEE }),
      {
        code: 'UNAUTHENTICATED',
        statusCode: 401,
      },
    );

    expectAppError(
      () => actorFromHeaders({ userId: 'emp-001', role: undefined }),
      {
        code: 'UNAUTHENTICATED',
        statusCode: 401,
      },
    );
  });

  it('rejects unsupported roles', () => {
    expectAppError(
      () => actorFromHeaders({ userId: 'emp-001', role: 'ADMIN' }),
      {
        code: 'FORBIDDEN_ROLE',
        statusCode: 403,
      },
    );
  });
});
