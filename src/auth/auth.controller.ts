import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
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
import { VerifyEmailDto } from './dto/verify-email.dto';
import { EmailVerificationService } from './email-verification.service';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import { randomBytes, timingSafeEqual } from 'crypto';
import { GoogleAuthService } from './google-auth.service';
import { AccessGrant, AuthTokens, TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly environmentService: EnvironmentService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly tokenService: TokenService,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  @Get('google')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  google(@Res() response: Response) {
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    response.cookie('oauth_google_state', state, this.oauthCookieOptions());
    response.cookie('oauth_google_nonce', nonce, this.oauthCookieOptions());
    response.redirect(this.googleAuthService.authorizationUrl(state, nonce));
  }

  @Get('google/callback')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const expectedState = this.getCookie(request, 'oauth_google_state');
    const nonce = this.getCookie(request, 'oauth_google_nonce');
    response.clearCookie('oauth_google_state', this.oauthCookieOptions());
    response.clearCookie('oauth_google_nonce', this.oauthCookieOptions());
    if (error || !code || !nonce || !this.sameValue(state, expectedState)) {
      return response.redirect(this.googleErrorUrl());
    }
    try {
      const user = await this.googleAuthService.authenticateCallback(
        code,
        nonce,
      );
      if (user.status !== 'ACTIVE') {
        return response.redirect(this.googleErrorUrl());
      }
      const tokens = await this.tokenService.createSession(user);
      this.setSessionCookies(response, tokens);
      return response.redirect(
        `${this.environmentService.getOrThrow('FRONTEND_URL')}${user.roles.length === 0 ? '/perfil' : '/'}`,
      );
    } catch {
      return response.redirect(this.googleErrorUrl());
    }
  }

  @Post('register')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() dto: RegisterDto) {
    await this.authService.register(dto);
    return {
      message: 'Enviamos um link de confirmação para o e-mail informado.',
    };
  }

  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const confirmation = await this.emailVerificationService.confirm(dto.token);
    if (confirmation.kind === 'registered') {
      this.setSessionCookies(response, confirmation.tokens);
    }
    return { verified: true };
  }

  @Post('email-verification')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async requestEmailVerification(@Req() request: AuthenticatedRequest) {
    await this.emailVerificationService.requestForUser(request.user.id);
    return { message: 'Enviamos um link de confirmação para o seu e-mail.' };
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
  @Throttle({ default: { limit: 10, ttl: 60000 } })
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
    tokens: AuthTokens | AccessGrant,
  ): void {
    response.cookie('access_token', tokens.accessToken, {
      ...this.cookieOptions(),
      maxAge: tokens.accessTokenExpiresAt.getTime() - Date.now(),
    });
    if ('refreshToken' in tokens) {
      response.cookie('refresh_token', tokens.refreshToken, {
        ...this.cookieOptions(),
        maxAge: tokens.refreshTokenExpiresAt.getTime() - Date.now(),
      });
    }
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.environmentService.get('NODE_ENV') === 'production',
      domain: this.environmentService.get('COOKIE_DOMAIN') || undefined,
      path: '/',
    };
  }

  private oauthCookieOptions() {
    return { ...this.cookieOptions(), maxAge: 10 * 60 * 1000 };
  }

  private googleErrorUrl(): string {
    return `${this.environmentService.getOrThrow('FRONTEND_URL')}/login?error=google-auth`;
  }

  private sameValue(
    value: string | undefined,
    expected: string | undefined,
  ): boolean {
    if (typeof value !== 'string' || !value || !expected) return false;
    const actualBytes = Buffer.from(value);
    const expectedBytes = Buffer.from(expected);
    return (
      actualBytes.length === expectedBytes.length &&
      timingSafeEqual(actualBytes, expectedBytes)
    );
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
