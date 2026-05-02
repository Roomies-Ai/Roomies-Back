import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AppLogger } from './app-logger.service';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new AppLogger('RequestLogger');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, url } = req;
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const { statusCode } = res;
      const userId: string | undefined = (req as any)['user']?.id;

      this.logger.log(
        `${method} ${url} ${statusCode}`,
        'RequestLogger',
        { duration: `${duration}ms`, ...(userId && { userId }) },
      );
    });

    next();
  }
}
