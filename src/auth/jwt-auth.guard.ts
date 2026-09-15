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
    const token = request.cookies?.access_token as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Autenticação necessária.');
    }

    try {
      const payload = await this.tokenService.verifyAccessToken(token);
      request.user = { id: payload.sub, roles: payload.roles };
      return true;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }
  }
}
