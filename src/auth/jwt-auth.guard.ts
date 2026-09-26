import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { TokenService } from './token.service';

export type AuthenticatedRequest = Request & {
  user: { id: string; roles: string[] };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies: unknown = request.cookies;
    const token =
      typeof cookies === 'object' &&
      cookies !== null &&
      'access_token' in cookies &&
      typeof cookies.access_token === 'string'
        ? cookies.access_token
        : undefined;

    if (!token) {
      throw new UnauthorizedException('Autenticação necessária.');
    }

    request.user = await this.tokenService.authenticate(token);
    return true;
  }
}
