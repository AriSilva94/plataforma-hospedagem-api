import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('confere a senha contra o hash existente', async () => {
    const hash = await service.hash('a-safe-password');

    await expect(
      service.verifyIfPresent(hash, 'a-safe-password'),
    ).resolves.toBe(true);
    await expect(service.verifyIfPresent(hash, 'wrong-password')).resolves.toBe(
      false,
    );
  });

  it.each([null, undefined])(
    'executa a verificação com hash fictício quando o hash é %s',
    async (hash) => {
      const verify = jest.spyOn(service, 'verify');

      await expect(
        service.verifyIfPresent(hash, 'a-safe-password'),
      ).resolves.toBe(false);
      expect(verify).toHaveBeenCalledWith(
        expect.stringMatching(/^\$argon2id\$/),
        'a-safe-password',
      );
      verify.mockRestore();
    },
  );
});
