import { resolveHouseServices } from './house-services';

const inherited = {
  hasCleaner: null,
  cleaningFrequency: null,
  smokingPolicy: null,
};

describe('resolveHouseServices', () => {
  const property = {
    hasCleaner: true,
    cleaningFrequency: 'WEEKLY' as const,
    smokingPolicy: 'NOT_ALLOWED' as const,
  };

  it('herda do imóvel quando o quarto não define', () => {
    expect(resolveHouseServices(property, inherited)).toEqual(property);
  });

  it('usa a faxina do quarto como um conjunto e a política própria', () => {
    expect(
      resolveHouseServices(property, {
        hasCleaner: false,
        cleaningFrequency: null,
        smokingPolicy: 'ALLOWED',
      }),
    ).toEqual({
      hasCleaner: false,
      cleaningFrequency: null,
      smokingPolicy: 'ALLOWED',
    });
  });
});
