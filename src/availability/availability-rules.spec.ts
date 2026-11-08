import {
  availabilityWindowEnd,
  isDateBlocked,
  isRangeFree,
  isValidIsoDate,
  normalizeAvailability,
  todayInSaoPaulo,
  weekdayOf,
} from './availability-rules';

describe('availability-rules', () => {
  const dateBlocked = { blockedWeekdays: [], blockedDates: ['2026-12-10'] };

  it('computes today in Sao Paulo timezone', () => {
    expect(todayInSaoPaulo(new Date('2026-11-09T02:30:00Z'))).toBe(
      '2026-11-08',
    );
  });

  it('computes the window end', () => {
    expect(availabilityWindowEnd('2026-11-08')).toBe('2027-11-08');
    expect(availabilityWindowEnd('2028-02-29')).toBe('2029-02-28');
  });

  it('validates ISO dates', () => {
    expect(isValidIsoDate('2026-12-10')).toBe(true);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('10/12/2026')).toBe(false);
  });

  it('returns the weekday', () => {
    expect(weekdayOf('2026-12-06')).toBe(0);
  });

  it('detects blocked dates and weekdays', () => {
    expect(isDateBlocked('2026-12-10', dateBlocked)).toBe(true);
    expect(
      isDateBlocked('2026-12-13', { blockedWeekdays: [0], blockedDates: [] }),
    ).toBe(true);
  });

  describe('isRangeFree', () => {
    const today = '2026-12-01';

    it.each([
      ['2026-12-08', '2026-12-09', true],
      ['2026-12-08', '2026-12-10', false],
      ['2026-12-10', '2026-12-12', false],
      ['2026-12-09', '2026-12-11', false],
      ['2026-12-11', '2026-12-12', true],
      ['2026-12-09', '2026-12-08', false],
      ['2026-11-30', '2026-12-02', false],
      ['2027-11-30', '2027-12-02', false],
      ['2026-12-08', '2026-12-08', true],
      ['2026-12-10', '2026-12-10', false],
    ])('%s -> %s is %s', (checkIn, checkOut, expected) => {
      expect(isRangeFree(checkIn, checkOut, dateBlocked, today)).toBe(expected);
    });
  });

  it('normalizes availability', () => {
    expect(
      normalizeAvailability({
        blockedWeekdays: [0, 0, 6],
        blockedDates: ['2026-12-13', '2026-12-10', '2026-12-10'],
      }),
    ).toEqual({ blockedWeekdays: [0, 6], blockedDates: ['2026-12-10'] });
  });
});
