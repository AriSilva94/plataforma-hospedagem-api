import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EnvironmentService } from '../infrastructure/environment/environment.service';

describe('AuthController session cookies', () => {
  let app: INestApplication<App>;
  let domain: string | undefined;
  const tokens = { accessToken: 'access', refreshToken: 'refresh' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn().mockResolvedValue({ ...tokens, user: {} }),
            register: jest.fn().mockResolvedValue({ ...tokens, user: {} }),
            refresh: jest.fn().mockResolvedValue(tokens),
            logout: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EnvironmentService,
          useValue: {
            get: (name: string) =>
              name === 'COOKIE_DOMAIN' ? domain : 'production',
            getOrThrow: () => '30',
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['login', 'register', 'refresh', 'logout'])(
    'uses the shared domain for %s cookies',
    async (endpoint) => {
      domain = 'hml.example.com';
      const response = await request(app.getHttpServer())
        .post(`/auth/${endpoint}`)
        .set('Cookie', 'refresh_token=refresh')
        .send({});
      expect(response.status).toBeLessThan(300);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) {
        expect(cookie).toContain('Domain=hml.example.com');
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Lax');
        if (endpoint === 'logout') {
          expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
        }
      }
    },
  );

  it.each([undefined, ''])(
    'keeps host-only cookies when domain is %s',
    async (value) => {
      domain = value;
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({});
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(2);
      for (const cookie of cookies) {
        expect(cookie).not.toContain('Domain=');
      }
    },
  );
});
