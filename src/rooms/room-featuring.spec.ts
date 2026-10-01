import { featuringStatusOf } from './room-featuring';

const now = new Date('2026-09-30T12:00:00.000Z');
const hoursFromNow = (hours: number) =>
  new Date(now.getTime() + hours * 60 * 60 * 1000);

describe('featuringStatusOf', () => {
  it('NONE sem período', () => {
    expect(
      featuringStatusOf({ featuredFrom: null, featuredUntil: null }, now),
    ).toBe('NONE');
  });

  it('SCHEDULED antes do início', () => {
    expect(
      featuringStatusOf(
        { featuredFrom: hoursFromNow(1), featuredUntil: hoursFromNow(48) },
        now,
      ),
    ).toBe('SCHEDULED');
  });

  it('ACTIVE dentro do período', () => {
    expect(
      featuringStatusOf(
        { featuredFrom: hoursFromNow(-1), featuredUntil: hoursFromNow(1) },
        now,
      ),
    ).toBe('ACTIVE');
    expect(
      featuringStatusOf(
        { featuredFrom: now, featuredUntil: hoursFromNow(1) },
        now,
      ),
    ).toBe('ACTIVE');
  });

  it('ENDED quando o fim chegou ou passou', () => {
    expect(
      featuringStatusOf(
        { featuredFrom: hoursFromNow(-48), featuredUntil: hoursFromNow(-1) },
        now,
      ),
    ).toBe('ENDED');
    expect(
      featuringStatusOf(
        { featuredFrom: hoursFromNow(-1), featuredUntil: now },
        now,
      ),
    ).toBe('ENDED');
  });
});
