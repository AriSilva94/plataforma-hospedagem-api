import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EnvironmentService } from '../infrastructure/environment/environment.service';
import {
  EmailMessage,
  passwordChangedEmail,
  passwordResetEmail,
  welcomeEmail,
} from './email-templates';
import { PASSWORD_RESET_VALIDITY_MINUTES } from './password-reset.policy';

@Injectable()
export class EmailService implements OnApplicationShutdown {
  private transporter?: nodemailer.Transporter;

  constructor(private readonly environmentService: EnvironmentService) {}

  onApplicationShutdown(): void {
    this.transporter?.close();
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const resetUrl = this.frontendUrl('/redefinir-senha');
    resetUrl.hash = new URLSearchParams({ token }).toString();

    await this.send(
      email,
      passwordResetEmail(resetUrl.toString(), PASSWORD_RESET_VALIDITY_MINUTES),
    );
  }

  async sendPasswordChanged(email: string): Promise<void> {
    await this.send(
      email,
      passwordChangedEmail(this.frontendUrl('/recuperar-senha').toString()),
    );
  }

  async sendWelcome(email: string, name: string): Promise<void> {
    await this.send(
      email,
      welcomeEmail(name, this.frontendUrl('/perfil').toString()),
    );
  }

  private frontendUrl(path: string): URL {
    return new URL(path, this.environmentService.getOrThrow('FRONTEND_URL'));
  }

  private async send(to: string, message: EmailMessage): Promise<void> {
    this.transporter ??= this.createTransporter();

    await this.transporter.sendMail({
      from: this.environmentService.getOrThrow('EMAIL_FROM'),
      to,
      ...message,
    });
  }

  private createTransporter(): nodemailer.Transporter {
    const smtpUser = this.environmentService.get('SMTP_USER');
    const smtpPassword = this.environmentService.get('SMTP_PASSWORD');

    return nodemailer.createTransport({
      host: this.environmentService.getOrThrow('SMTP_HOST'),
      port: Number(this.environmentService.getOrThrow('SMTP_PORT')),
      secure: this.environmentService.getOrThrow('SMTP_SECURE') === 'true',
      pool: true,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      ...(smtpUser && smtpPassword
        ? { auth: { user: smtpUser, pass: smtpPassword } }
        : {}),
    });
  }
}
