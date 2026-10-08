import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailQueue } from './email-queue';
import { EmailVerificationService } from './email-verification.service';
import { EmailService } from './email.service';
import { EmailWorker } from './email-worker';
import { GoogleAuthService } from './google-auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleAuthService,
    PasswordService,
    TokenService,
    EmailService,
    EmailQueue,
    EmailVerificationService,
    EmailWorker,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard, TokenService],
})
export class AuthModule {}
