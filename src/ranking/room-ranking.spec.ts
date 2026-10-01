import { rankingScoreFor } from './room-ranking';

describe('rankingScoreFor', () => {
  it('usa a completude como sinal disponível', () => {
    expect(rankingScoreFor({ completenessScore: 0 })).toBe(0);
    expect(rankingScoreFor({ completenessScore: 82 })).toBe(82);
  });

  it('preserva a ordem relativa da completude', () => {
    expect(rankingScoreFor({ completenessScore: 90 })).toBeGreaterThan(
      rankingScoreFor({ completenessScore: 60 }),
    );
  });
});
