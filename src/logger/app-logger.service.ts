import { Injectable, Optional } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';

const LEVEL_LABEL: Record<string, string> = {
  log:     'INFO ',
  error:   'ERROR',
  warn:    'WARN ',
  debug:   'DEBUG',
  verbose: 'VERB ',
};

const LEVEL_COLOR: Record<string, string> = {
  log:     '\x1b[32m', // green
  error:   '\x1b[31m', // red
  warn:    '\x1b[33m', // yellow
  debug:   '\x1b[34m', // blue
  verbose: '\x1b[35m', // magenta
};

const R    = '\x1b[0m';
const GRAY = '\x1b[90m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';

@Injectable()
export class AppLogger implements LoggerService {
  private readonly isDev = process.env.NODE_ENV !== 'production';

  constructor(@Optional() private readonly context?: string) {}

  log(message: any, ...optionalParams: any[]): void {
    this.emit('log', String(message), this.resolveContext(optionalParams), this.resolveMeta(optionalParams));
  }

  error(message: any, ...optionalParams: any[]): void {
    this.emit('error', String(message), this.resolveContext(optionalParams), this.resolveMeta(optionalParams), true);
  }

  warn(message: any, ...optionalParams: any[]): void {
    this.emit('warn', String(message), this.resolveContext(optionalParams), this.resolveMeta(optionalParams));
  }

  debug(message: any, ...optionalParams: any[]): void {
    this.emit('debug', String(message), this.resolveContext(optionalParams), this.resolveMeta(optionalParams));
  }

  verbose(message: any, ...optionalParams: any[]): void {
    this.emit('verbose', String(message), this.resolveContext(optionalParams), this.resolveMeta(optionalParams));
  }

  // Returns the last string param as context, falling back to the constructor context.
  // NestJS internally passes context as the last string arg (e.g. error(msg, stack, context)).
  private resolveContext(params: any[]): string | undefined {
    let ctx = this.context;
    for (const p of params) {
      if (typeof p === 'string' && p) ctx = p;
    }
    return ctx;
  }

  // Returns the first plain object param as meta.
  private resolveMeta(params: any[]): object | undefined {
    return params.find((p) => p && typeof p === 'object' && !Array.isArray(p));
  }

  private emit(
    level: string,
    message: string,
    context?: string,
    meta?: object,
    isError = false,
  ): void {
    const stream = isError ? process.stderr : process.stdout;
    if (this.isDev) {
      stream.write(this.formatPretty(level, message, context, meta));
    } else {
      stream.write(this.formatJson(level, message, context, meta));
    }
  }

  private formatPretty(level: string, message: string, context?: string, meta?: object): string {
    const ts     = new Date().toISOString().replace('T', ' ').slice(0, 23);
    const color  = LEVEL_COLOR[level] ?? '';
    const label  = LEVEL_LABEL[level] ?? level.toUpperCase();
    const ctxStr = context ? ` ${CYAN}[${context}]${R}` : '';
    const metaStr = meta ? ` ${GRAY}| ${JSON.stringify(meta)}${R}` : '';
    return `${GRAY}[${ts}]${R} ${color}${BOLD}[${label}]${R}${ctxStr} ${message}${metaStr}\n`;
  }

  private formatJson(level: string, message: string, context?: string, meta?: object): string {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: level === 'log' ? 'info' : level,
      ...(context && { context }),
      message,
      ...(meta && { meta }),
    };
    return JSON.stringify(entry) + '\n';
  }
}
