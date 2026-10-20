import type { NextFunction, Request, Response } from 'express';
import { csrfProtection } from './csrf-protection.middleware';

const frontendUrl = 'https://app.domusx.test';

function execute(method: string, headers: Record<string, string> = {}) {
  const request = { method, headers } as unknown as Request;
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  const response = {
    status,
    json,
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  csrfProtection(frontendUrl)(request, response, next);
  return { status, next };
}

describe('csrfProtection', () => {
  it('recusa mutação originada por outro subdomínio', () => {
    const { status, next } = execute('POST', {
      origin: 'https://untrusted.domusx.test',
      'x-csrf-protection': '1',
    });

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('exige o cabeçalho explícito nas mutações do frontend', () => {
    const { status, next } = execute('PATCH', { origin: frontendUrl });

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('aceita a origem configurada com o cabeçalho de proteção', () => {
    const { next } = execute('DELETE', {
      origin: frontendUrl,
      'x-csrf-protection': '1',
    });

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('recusa navegador cross-site mesmo sem Origin', () => {
    const { status, next } = execute('POST', {
      'sec-fetch-site': 'cross-site',
    });

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('mantém chamadas não browser e métodos seguros', () => {
    expect(execute('POST').next).toHaveBeenCalledTimes(1);
    expect(
      execute('GET', { origin: 'https://untrusted.domusx.test' }).next,
    ).toHaveBeenCalledTimes(1);
  });
});
