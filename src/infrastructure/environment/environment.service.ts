import { Injectable } from '@nestjs/common';

@Injectable()
export class EnvironmentService {
  constructor() {
    const required = [
      'DATABASE_URL',
      'REDIS_URL',
      'ACCESS_TOKEN_SECRET',
      'REFRESH_TOKEN_SECRET',
      'FRONTEND_URL',
      'SMTP_HOST',
      'SMTP_PORT',
      'EMAIL_FROM',
    ];
    for (const name of required) {
      this.getOrThrow(name);
    }
  }

  get(name: string): string | undefined {
    return process.env[name];
  }

  getOrThrow(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
    }
    return value;
  }
}
