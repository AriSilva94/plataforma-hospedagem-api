import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { configureApplication } from './../src/app.config';
import { AppModule } from './../src/app.module';
import { EmailService } from './../src/auth/email.service';
import { PrismaService } from './../src/infrastructure/prisma/prisma.service';
import { waitFor } from './support/e2e';

describe('Health endpoint (e2e)', () => {
  let app: INestApplication<App>;
  const originalRevision = process.env.APP_REVISION;

  beforeAll(() => {
    process.env.APP_REVISION = 'test-revision';
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'ok', revision: 'test-revision' });
  });

  it('cria a conta somente após a confirmação do e-mail', async () => {
    const email = `user-${randomUUID()}@example.com`;
    const prisma = app.get(PrismaService);
    const sendEmailConfirmation = jest.spyOn(
      app.get(EmailService),
      'sendEmailConfirmation',
    );

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Usuário de teste',
        email,
        password: 'uma-senha-segura',
      })
      .expect(202)
      .expect(({ headers }: { headers: unknown }) => {
        expect(getHeaderValues(headers, 'set-cookie')).toHaveLength(0);
      });
    await expect(
      prisma.user.findUnique({ where: { email } }),
    ).resolves.toBeNull();

    const sentTo = () =>
      sendEmailConfirmation.mock.calls.find(([to]) => to === email);
    await waitFor(() => sentTo() !== undefined);
    const token = sentTo()?.[1];

    const confirmation = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(200);
    const sessionCookies = getHeaderValues(confirmation.headers, 'set-cookie');
    expect(sessionCookies).toHaveLength(2);
    const cookieHeader = sessionCookies
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookieHeader)
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({
          email,
          roles: [],
          emailVerifiedAt: expect.any(String) as string,
        });
        expect(body).not.toHaveProperty('passwordHash');
      });
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(401);
    await prisma.user.deleteMany({ where: { email } });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  afterAll(() => {
    if (originalRevision === undefined) {
      delete process.env.APP_REVISION;
    } else {
      process.env.APP_REVISION = originalRevision;
    }
  });
});

function getHeaderValues(headers: unknown, name: string): string[] {
  if (typeof headers !== 'object' || headers === null || !(name in headers)) {
    return [];
  }
  const value = (headers as Record<string, unknown>)[name];
  if (!Array.isArray(value)) {
    return [];
  }
  const cookies: string[] = [];
  for (const cookie of value) {
    if (typeof cookie !== 'string') {
      return [];
    }
    cookies.push(cookie);
  }
  return cookies;
}
