import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { AppLogger } from './app-logger.service';

describe('AppLogger', () => {
  let stdoutSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // NODE_ENV is 'test' under Jest, so AppLogger's `isDev` flag defaults to true
  // here and these tests exercise the pretty-printed (non-production) branch.
  describe('pretty formatting (dev)', () => {
    it('log() writes an INFO-labeled line to stdout', () => {
      const logger = new AppLogger('MyContext');

      logger.log('hello world');

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output).toContain('INFO');
      expect(output).toContain('[MyContext]');
      expect(output).toContain('hello world');
    });

    it('error() writes to stderr, not stdout', () => {
      const logger = new AppLogger('MyContext');

      logger.error('boom');

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy.mock.calls[0][0] as string).toContain('ERROR');
    });

    it('warn() writes to stdout with a WARN label', () => {
      new AppLogger().warn('careful');

      expect(stdoutSpy.mock.calls[0][0] as string).toContain('WARN');
    });

    it('debug() writes to stdout with a DEBUG label', () => {
      new AppLogger().debug('details');

      expect(stdoutSpy.mock.calls[0][0] as string).toContain('DEBUG');
    });

    it('verbose() writes to stdout with a VERB label', () => {
      new AppLogger().verbose('chatty');

      expect(stdoutSpy.mock.calls[0][0] as string).toContain('VERB');
    });

    it('uses the last string param as context, overriding the constructor context', () => {
      const logger = new AppLogger('CtorContext');

      logger.log('hi', 'OverrideContext');

      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output).toContain('[OverrideContext]');
      expect(output).not.toContain('[CtorContext]');
    });

    it('includes the first plain-object param as meta', () => {
      new AppLogger().log('hi', { duration: '5ms' });

      const output = stdoutSpy.mock.calls[0][0] as string;
      expect(output).toContain('duration');
      expect(output).toContain('5ms');
    });
  });

  describe('json formatting (production)', () => {
    it('emits a structured JSON line with level/context/message/meta', () => {
      const logger = new AppLogger('MyContext');
      (logger as unknown as { isDev: boolean }).isDev = false;

      logger.log('hello', { duration: '5ms' });

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed).toMatchObject({
        level: 'info',
        context: 'MyContext',
        message: 'hello',
        meta: { duration: '5ms' },
      });
    });

    it('keeps non-"log" levels as-is (e.g. "warn" stays "warn")', () => {
      const logger = new AppLogger();
      (logger as unknown as { isDev: boolean }).isDev = false;

      logger.warn('careful');

      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.level).toBe('warn');
    });
  });
});