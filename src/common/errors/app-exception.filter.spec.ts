import { BadRequestException, HttpStatus, Logger } from '@nestjs/common';
import { AppExceptionFilter } from './app-exception.filter';
import { AppError } from './app-error';

describe('AppExceptionFilter', () => {
  function buildHost() {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    };

    return { host, response };
  }

  it('serializes AppError with its domain error code', () => {
    const { host, response } = buildHost();
    const filter = new AppExceptionFilter();

    filter.catch(
      new AppError('INSUFFICIENT_BALANCE', 422, 'Not enough balance.'),
      host as never,
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 422,
      error: 'INSUFFICIENT_BALANCE',
      message: 'Not enough balance.',
    });
  });

  it('serializes HttpException response payload messages', () => {
    const { host, response } = buildHost();
    const filter = new AppExceptionFilter();

    filter.catch(
      new BadRequestException(['field must be valid']),
      host as never,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'BadRequestException',
      message: ['field must be valid'],
    });
  });

  it('falls back to the HttpException message when payload has no message field', () => {
    const { host, response } = buildHost();
    const filter = new AppExceptionFilter();
    const exception = new BadRequestException('Invalid request.');

    jest.spyOn(exception, 'getResponse').mockReturnValue('Invalid request.');
    filter.catch(exception, host as never);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'BadRequestException',
      message: 'Invalid request.',
    });
  });

  it('serializes unknown errors as internal server errors', () => {
    const { host, response } = buildHost();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filter = new AppExceptionFilter();

    filter.catch(new Error('boom'), host as never);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
  });
});
