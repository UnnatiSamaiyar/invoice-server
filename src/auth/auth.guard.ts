import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { verifyAuthToken } from './auth.utils';

export type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email: string;
  };
};

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const payload = verifyAuthToken(token);

    if (!payload) {
      throw new UnauthorizedException('Invalid or expired authorization token');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
    };

    return true;
  }
}
