import { CITY_NAMES_BY_STATE } from './brazilian-cities.data';

const citiesByState = new Map(
  Object.entries(CITY_NAMES_BY_STATE).map(([state, names]) => [
    state,
    names.split('|'),
  ]),
);

export function citiesOfState(state: string): string[] | undefined {
  return citiesByState.get(state);
}

export function isCityOfState(state: string, city: string): boolean {
  return citiesByState.get(state)?.includes(city) ?? false;
}
