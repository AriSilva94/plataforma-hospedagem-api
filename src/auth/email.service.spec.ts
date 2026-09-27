import { EmailService } from './email.service';
import * as nodemailer from 'nodemailer';
import { EnvironmentService } from '../infrastructure/environment/environment.service';

describe('EmailService', () => {
  it('autentica o transporte SMTP com TLS e as credenciais configuradas', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const createTransport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as never);
    const environmentService = {
      get: jest.fn(
        (name: string) =>
          ({ SMTP_USER: 'auth@arisilva.tech', SMTP_PASSWORD: 'password' })[
            name
          ],
      ),
      getOrThrow: jest.fn(
        (name: string) =>
          ({
            SMTP_HOST: 'smtp.hostinger.com',
            SMTP_PORT: '465',
            SMTP_SECURE: 'true',
            EMAIL_FROM: 'DOMUS X <auth@arisilva.tech>',
            FRONTEND_URL: 'https://domusx-dev.arisilva.tech',
          })[name],
      ),
    } as unknown as EnvironmentService;

    await new EmailService(environmentService).sendPasswordReset(
      'guest@example.com',
      'token',
    );

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      auth: { user: 'auth@arisilva.tech', pass: 'password' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'DOMUS X <auth@arisilva.tech>' }),
    );
  });
});
