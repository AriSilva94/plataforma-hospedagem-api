export type RoomAvailability = {
  blockedWeekdays: number[];
  blockedDates: string[];
};

export const AVAILABILITY_WINDOW_MONTHS = 12;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toUtcMs = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const fromUtcMs = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

export const todayInSaoPaulo = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    now,
  );

export const isValidIsoDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtcMs(toUtcMs(value)) === value;

export const weekdayOf = (date: string): number =>
  new Date(toUtcMs(date)).getUTCDay();

export const availabilityWindowEnd = (today: string): string => {
  const [year, month, day] = today.split('-').map(Number);
  const target = new Date(
    Date.UTC(year, month - 1 + AVAILABILITY_WINDOW_MONTHS, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtcMs(target.getTime());
};

export const isDateBlocked = (
  date: string,
  availability: RoomAvailability,
): boolean =>
  availability.blockedWeekdays.includes(weekdayOf(date)) ||
  availability.blockedDates.includes(date);

export const isRangeFree = (
  checkIn: string,
  checkOut: string,
  availability: RoomAvailability,
  today: string,
): boolean => {
  if (
    checkOut < checkIn ||
    checkIn < today ||
    checkOut > availabilityWindowEnd(today)
  ) {
    return false;
  }
  for (let ms = toUtcMs(checkIn); ms <= toUtcMs(checkOut); ms += DAY_IN_MS) {
    if (isDateBlocked(fromUtcMs(ms), availability)) {
      return false;
    }
  }
  return true;
};

export const normalizeAvailability = (
  input: RoomAvailability,
): RoomAvailability => {
  const blockedWeekdays = [...new Set(input.blockedWeekdays)].sort(
    (a, b) => a - b,
  );
  const blockedDates = [...new Set(input.blockedDates)]
    .filter((date) => !blockedWeekdays.includes(weekdayOf(date)))
    .sort();
  return { blockedWeekdays, blockedDates };
};
