import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { configureApplication } from './../src/app.config';
import { AppModule } from './../src/app.module';

describe('Health endpoint (e2e)', () => {
  let app: INestApplication<App>;

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
      .expect({ status: 'ok' });
  });

  it('cadastra um hóspede e permite consultar o próprio perfil', async () => {
    const email = `guest-${randomUUID()}@example.com`;

    const registration = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Hóspede de teste',
        email,
        password: 'uma-senha-segura',
        role: 'GUEST',
      })
      .expect(201);

    const sessionCookies = getHeaderValues(registration.headers, 'set-cookie');
    expect(sessionCookies).toHaveLength(2);
    const cookieHeader = sessionCookies
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');

    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', cookieHeader)
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({ email, roles: ['GUEST'] });
        expect(body).not.toHaveProperty('passwordHash');
      });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
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
