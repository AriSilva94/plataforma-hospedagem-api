import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EnvironmentService } from '../infrastructure/environment/environment.service';

@Injectable()
export class EmailService {
  constructor(private readonly environmentService: EnvironmentService) {}

  async sendPasswordReset(email: string, token: string): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.environmentService.getOrThrow('SMTP_HOST'),
      port: Number(this.environmentService.getOrThrow('SMTP_PORT')),
      secure: this.environmentService.getOrThrow('SMTP_SECURE') === 'true',
      auth: {
        user: this.environmentService.getOrThrow('SMTP_USER'),
        pass: this.environmentService.getOrThrow('SMTP_PASSWORD'),
      },
    });
    const frontendUrl = this.environmentService.getOrThrow('FRONTEND_URL');
    const resetUrl = new URL('/redefinir-senha', frontendUrl);
    resetUrl.searchParams.set('token', token);

    await transporter.sendMail({
      from: this.environmentService.getOrThrow('EMAIL_FROM'),
      to: email,
      subject: 'Redefinição de senha',
      text: `Use este link para redefinir sua senha: ${resetUrl.toString()}`,
    });
  }
}
