import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthResult, AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { EnvironmentService } from '../infrastructure/environment/environment.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respondWithSession(
      await this.authService.register(dto),
      response,
    );
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respondWithSession(await this.authService.login(dto), response);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.getCookie(request, 'refresh_token');
    if (!refreshToken) {
      return { authenticated: false };
    }
    const tokens = await this.authService.refresh(refreshToken);
    this.setSessionCookies(response, tokens);
    return { authenticated: true };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(this.getCookie(request, 'refresh_token'));
    response.clearCookie('access_token', this.cookieOptions());
    response.clearCookie('refresh_token', this.cookieOptions());
  }

  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto);
    return {
      message:
        'Se houver uma conta para este e-mail, enviaremos as instruções.',
    };
  }

  @Post('reset-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  private respondWithSession(result: AuthResult, response: Response) {
    this.setSessionCookies(response, result);
    return { user: result.user };
  }

  private setSessionCookies(
    response: Response,
    tokens: { accessToken: string; refreshToken: string },
  ): void {
    response.cookie('access_token', tokens.accessToken, {
      ...this.cookieOptions(),
      maxAge: 15 * 60 * 1000,
    });
    response.cookie('refresh_token', tokens.refreshToken, {
      ...this.cookieOptions(),
      maxAge:
        Number(this.environmentService.getOrThrow('REFRESH_TOKEN_TTL_DAYS')) *
        24 *
        60 *
        60 *
        1000,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.environmentService.get('NODE_ENV') === 'production',
      path: '/',
    };
  }

  private getCookie(request: Request, name: string): string | undefined {
    const cookies: unknown = request.cookies;
    if (!this.isRecord(cookies) || !(name in cookies)) {
      return undefined;
    }
    const value = cookies[name];
    return typeof value === 'string' ? value : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
