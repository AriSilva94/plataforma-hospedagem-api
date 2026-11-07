import { CITY_NAMES_BY_STATE } from './brazilian-cities.data';

const citiesByState = new Map(
  Object.entries(CITY_NAMES_BY_STATE).map(([state, names]) => [
    state,
    names.split('|'),
  ]),
);

export const CITY_SEARCH_LIMIT = 10;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

const searchableCities = [...citiesByState].flatMap(([state, cities]) =>
  cities.map((city) => ({ city, state, key: normalize(city) })),
);

export function citiesOfState(state: string): string[] | undefined {
  return citiesByState.get(state);
}

export function isCityOfState(state: string, city: string): boolean {
  return citiesByState.get(state)?.includes(city) ?? false;
}

export function searchCities(query: string): { city: string; state: string }[] {
  const term = normalize(query.trim());
  const rank = (key: string) =>
    key === term ? 0 : key.startsWith(term) ? 1 : 2;

  return searchableCities
    .filter(({ key }) => key.includes(term))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.length - b.key.length)
    .slice(0, CITY_SEARCH_LIMIT)
    .map(({ city, state }) => ({ city, state }));
}
