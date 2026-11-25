import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { type AppConfig, setting } from '../../config/app-config.js';

// Every route needs the x-api-key header except routes marked @Public() (docs/ARCHITECTURE.md §3.13).

const IS_PUBLIC = 'openroles:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Constant-time comparison: hashing first makes both sides the same length. */
export function keysMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected: string;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.expected = setting(config as unknown as AppConfig, 'API_KEY');
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const header = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>()
      .headers['x-api-key'];
    if (typeof header === 'string' && keysMatch(header, this.expected)) return true;
    throw new UnauthorizedException('Missing or wrong API key');
  }
}
