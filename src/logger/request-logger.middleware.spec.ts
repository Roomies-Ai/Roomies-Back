import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import type { Request, Response } from 'express';
import { RequestLoggerMiddleware } from './request-logger.middleware';
import { AppLogger } from './app-logger.service';

describe('RequestLoggerMiddleware', () => {
  let middleware: RequestLoggerMiddleware;
  let logSpy: jest.SpiedFunction<AppLogger['log']>;
  let next: jest.Mock<() => void>;
  let finishHandlers: Array<() => void>;

  const makeRes = (statusCode: number) => {
    finishHandlers = [];
    return {
      statusCode,
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'finish') finishHandlers.push(cb);
      }),
    } as unknown as Response;
  };

  beforeEach(() => {
    logSpy = jest.spyOn(AppLogger.prototype, 'log').mockImplementation(() => undefined);
    middleware = new RequestLoggerMiddleware();
    next = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls next() synchronously without logging yet', () => {
    const req = { method: 'GET', url: '/tasks' } as unknown as Request;
    const res = makeRes(200);

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs method/url/status and a duration once the response finishes', () => {
    const req = { method: 'POST', url: '/households' } as unknown as Request;
    const res = makeRes(201);

    middleware.use(req, res, next);
    finishHandlers.forEach((cb) => cb());

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [message, context, meta] = logSpy.mock.calls[0];
    expect(message).toBe('POST /households 201');
    expect(context).toBe('RequestLogger');
    expect(meta).toEqual(
      expect.objectContaining({ duration: expect.stringMatching(/^\d+ms$/) }),
    );
  });

  it('includes userId in meta when the request is authenticated', () => {
    const req = {
      method: 'GET',
      url: '/users/me',
      user: { id: 'user-1' },
    } as unknown as Request;
    const res = makeRes(200);

    middleware.use(req, res, next);
    finishHandlers.forEach((cb) => cb());

    const meta = logSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(meta.userId).toBe('user-1');
  });

  it('omits userId from meta when there is no authenticated user', () => {
    const req = { method: 'GET', url: '/health' } as unknown as Request;
    const res = makeRes(200);

    middleware.use(req, res, next);
    finishHandlers.forEach((cb) => cb());

    const meta = logSpy.mock.calls[0][2] as Record<string, unknown>;
    expect(meta.userId).toBeUndefined();
  });
});
