import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthenticatedRequest } from './jwt-auth.guard';
import { TokenService } from './token.service';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    const cookies: unknown = request.cookies;
    const token =
      typeof cookies === 'object' &&
      cookies !== null &&
      'access_token' in cookies &&
      typeof cookies.access_token === 'string'
        ? cookies.access_token
        : undefined;

    if (token) {
      request.user = await this.tokenService
        .authenticate(token)
        .catch(() => undefined);
    }
    return true;
  }
}
