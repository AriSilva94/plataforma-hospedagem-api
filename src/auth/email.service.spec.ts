import { EmailService } from './email.service';
import * as nodemailer from 'nodemailer';
import { EnvironmentService } from '../infrastructure/environment/environment.service';

describe('EmailService', () => {
  type SentMessage = { subject: string; text: string; html: string };

  function createService() {
    const sendMail = jest
      .fn<Promise<void>, [SentMessage]>()
      .mockResolvedValue(undefined);
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

    return {
      service: new EmailService(environmentService),
      sendMail,
      createTransport,
    };
  }

  it('autentica o transporte SMTP com TLS e as credenciais configuradas', async () => {
    const { service, sendMail, createTransport } = createService();

    await service.sendPasswordReset('guest@example.com', 'token');

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.hostinger.com',
        port: 465,
        secure: true,
        auth: { user: 'auth@arisilva.tech', pass: 'password' },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'DOMUS X <auth@arisilva.tech>' }),
    );
  });

  it('envia a redefinição de senha em HTML e texto com o link do token', async () => {
    const { service, sendMail } = createService();

    await service.sendPasswordReset('guest@example.com', 'token');

    const message = sendMail.mock.calls[0][0];
    const resetUrl =
      'https://domusx-dev.arisilva.tech/redefinir-senha#token=token';
    expect(message.text).toContain(resetUrl);
    expect(message.html).toContain(`href="${resetUrl}"`);
    expect(message.html).toContain('Redefinir senha');
    expect(message.text).toContain('O link vale por 1 hora');
  });

  it('reutiliza o mesmo transporte SMTP entre envios', async () => {
    const { service, createTransport } = createService();
    createTransport.mockClear();

    await service.sendPasswordReset('guest@example.com', 'token');
    await service.sendPasswordChanged('guest@example.com');

    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('avisa a troca de senha com atalho para recuperar a conta', async () => {
    const { service, sendMail } = createService();

    await service.sendPasswordChanged('guest@example.com');

    const message = sendMail.mock.calls[0][0];
    expect(message.subject).toBe('Sua senha da DOMUS X foi alterada');
    expect(message.html).toContain(
      'href="https://domusx-dev.arisilva.tech/recuperar-senha"',
    );
  });

  it('escapa o nome do usuário no e-mail de boas-vindas', async () => {
    const { service, sendMail } = createService();

    await service.sendWelcome('guest@example.com', '<b>Ana</b> Silva');

    const message = sendMail.mock.calls[0][0];
    expect(message.html).toContain('Boas-vindas, &lt;b&gt;Ana&lt;/b&gt;.');
    expect(message.html).not.toContain('<b>Ana</b>');
    expect(message.html).toContain(
      'href="https://domusx-dev.arisilva.tech/perfil"',
    );
  });
});
