import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createE2eApp } from './support/e2e';

describe('Security headers (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createE2eApp());
  });

  it('envia cabeçalhos de segurança e não expõe a tecnologia do servidor', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'",
    );
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(response.headers).not.toHaveProperty('x-powered-by');
  });

  it('mantém o CORS com credenciais para o frontend', async () => {
    const origin = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const response = await request(app.getHttpServer())
      .get('/rooms?limit=1')
      .set('Origin', origin)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('mantém os cabeçalhos em respostas de erro', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .expect(401);

    expect(response.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(response.headers).not.toHaveProperty('x-powered-by');
  });

  afterAll(async () => {
    await app?.close();
  });
});
