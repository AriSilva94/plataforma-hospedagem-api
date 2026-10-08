import type { Request } from 'express';
import { resolveClientIp } from './client-ip-throttler.guard';

describe('resolveClientIp', () => {
  const internalSecret = 'segredo-interno-de-teste';
  const cloudflareSecret = 'segredo-da-cloudflare-de-teste';
  const connectionIp = '10.0.0.5';

  function request(headers: Record<string, string | string[]>): Request {
    return { ip: connectionIp, headers } as unknown as Request;
  }

  it('usa o IP repassado pelo frontend quando o segredo interno confere', () => {
    expect(
      resolveClientIp(
        request({
          'x-internal-secret': internalSecret,
          'x-client-ip': '203.0.113.7',
          'x-origin-secret': cloudflareSecret,
          'cf-connecting-ip': '198.51.100.9',
        }),
        { internalSecret, cloudflareSecret },
      ),
    ).toBe('203.0.113.7');
  });

  it('usa o IP informado pela Cloudflare quando o segredo de origem confere', () => {
    expect(
      resolveClientIp(
        request({
          'x-origin-secret': cloudflareSecret,
          'cf-connecting-ip': '198.51.100.9',
        }),
        { internalSecret, cloudflareSecret },
      ),
    ).toBe('198.51.100.9');
  });

  it.each([
    ['IP do frontend sem segredo', { 'x-client-ip': '203.0.113.7' }],
    [
      'IP do frontend com segredo errado',
      { 'x-internal-secret': 'outro-segredo', 'x-client-ip': '203.0.113.7' },
    ],
    [
      'IP do frontend que não é IP',
      { 'x-internal-secret': internalSecret, 'x-client-ip': 'qualquer-coisa' },
    ],
    [
      'IP do frontend repetido',
      {
        'x-internal-secret': internalSecret,
        'x-client-ip': ['203.0.113.7', '1.1.1.1'],
      },
    ],
    [
      'IP da Cloudflare forjado em acesso direto',
      { 'cf-connecting-ip': '198.51.100.9' },
    ],
    [
      'IP da Cloudflare com segredo errado',
      {
        'x-origin-secret': 'outro-segredo',
        'cf-connecting-ip': '198.51.100.9',
      },
    ],
    [
      'IP da Cloudflare que não é IP',
      { 'x-origin-secret': cloudflareSecret, 'cf-connecting-ip': 'abc' },
    ],
  ])('usa o IP da conexão ao receber %s', (_case, headers) => {
    expect(
      resolveClientIp(request(headers), { internalSecret, cloudflareSecret }),
    ).toBe(connectionIp);
  });

  it('não confia em nenhum cabeçalho quando os segredos não estão configurados', () => {
    expect(
      resolveClientIp(
        request({
          'x-internal-secret': '',
          'x-client-ip': '203.0.113.7',
          'x-origin-secret': '',
          'cf-connecting-ip': '198.51.100.9',
        }),
        {},
      ),
    ).toBe(connectionIp);
  });
});
