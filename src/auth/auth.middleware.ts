import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { EnvironmentVariables } from '../config/environment-variables.type';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables>,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log(`AuthMiddleware: No Bearer token found for ${req.method} ${req.url}`);
      return next();
    }

    const token = authHeader.split(' ')[1];

    try {
      const secret = this.configService.get('JWT_SECRET', { infer: true });
      if (!secret) {
        console.error('AuthMiddleware: JWT_SECRET is missing!');
        throw new Error('JWT_SECRET is not defined in config');
      }

      const decoded = jwt.verify(token, secret) as any;
      req['user'] = decoded;
      next();
    } catch (err) {
      console.error(`AuthMiddleware: Token validation failed for ${req.method} ${req.url}:`, err.message);
      next();
    }
  }
}
