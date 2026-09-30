import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PostalCodeService } from './postal-code.service';

describe('PostalCodeService', () => {
  const service = new PostalCodeService();
  const fetchMock = jest.spyOn(globalThis, 'fetch');

  afterEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  function respond(body: unknown, status = 200) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
  }

  it('mapeia a resposta do provedor para o endereço', async () => {
    respond({
      logradouro: 'Rua das Flores',
      bairro: 'Centro',
      localidade: 'Brasília',
      uf: 'DF',
    });

    await expect(service.lookup('70000000')).resolves.toEqual({
      street: 'Rua das Flores',
      neighborhood: 'Centro',
      city: 'Brasília',
      state: 'DF',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://viacep.com.br/ws/70000000/json/',
      expect.objectContaining({
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });

  it('devolve campos vazios para CEP geral de cidade', async () => {
    respond({ localidade: 'Palmas', uf: 'TO' });

    await expect(service.lookup('77000000')).resolves.toEqual({
      street: '',
      neighborhood: '',
      city: 'Palmas',
      state: 'TO',
    });
  });

  it('responde 404 quando o CEP não existe', async () => {
    respond({ erro: true });

    await expect(service.lookup('99999999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('responde 503 quando o provedor falha ou demora', async () => {
    respond({}, 500);
    await expect(service.lookup('70000000')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(service.lookup('70000000')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
