import { CITY_SEARCH_LIMIT, searchCities } from './brazilian-cities';

describe('searchCities', () => {
  it('ignora acentos e maiúsculas', () => {
    expect(searchCities('SAO PAULO')).toContainEqual({
      city: 'São Paulo',
      state: 'SP',
    });
  });

  it('lista primeiro o nome exato e depois os que começam com o termo', () => {
    expect(searchCities('natal')[0]).toEqual({ city: 'Natal', state: 'RN' });

    const cities = searchCities('bom jesus').map(({ city }) => city);
    const firstPrefixed = cities.findIndex((city) => city !== 'Bom Jesus');
    expect(firstPrefixed).toBeGreaterThan(0);
    expect(cities.slice(firstPrefixed)).not.toContain('Bom Jesus');
  });

  it('desempata pelos nomes mais curtos, mais próximos do termo', () => {
    expect(searchCities('campin')).toContainEqual({
      city: 'Campinas',
      state: 'SP',
    });
  });

  it('limita a quantidade de resultados', () => {
    expect(searchCities('sa')).toHaveLength(CITY_SEARCH_LIMIT);
  });

  it('distingue cidades homônimas pela UF', () => {
    const states = searchCities('bom jesus')
      .filter(({ city }) => city === 'Bom Jesus')
      .map(({ state }) => state);

    expect(new Set(states).size).toBe(states.length);
    expect(states.length).toBeGreaterThan(1);
  });

  it('não encontra termo inexistente', () => {
    expect(searchCities('xyzw')).toEqual([]);
  });
});
