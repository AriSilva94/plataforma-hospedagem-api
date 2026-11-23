import { ROOM_STORY_TTL_MS } from './room-catalog';
import { storyExpiresAt } from './room-story';

describe('storyExpiresAt', () => {
  it('devolve null quando o story não foi aprovado', () => {
    expect(storyExpiresAt({ storyApprovedAt: null })).toBeNull();
  });

  it('expira 24 horas depois da aprovação', () => {
    const storyApprovedAt = new Date('2026-11-18T12:00:00.000Z');

    expect(storyExpiresAt({ storyApprovedAt })).toEqual(
      new Date(storyApprovedAt.getTime() + ROOM_STORY_TTL_MS),
    );
    expect(ROOM_STORY_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
