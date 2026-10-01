export const RANKING_VERSION = 1;

export interface RankingSignals {
  completenessScore: number;
}

const RANKING_WEIGHTS: Record<keyof RankingSignals, number> = {
  completenessScore: 1,
};

export function rankingScoreFor(signals: RankingSignals): number {
  const signalNames = Object.keys(RANKING_WEIGHTS) as (keyof RankingSignals)[];
  return Math.round(
    signalNames.reduce(
      (score, signal) => score + signals[signal] * RANKING_WEIGHTS[signal],
      0,
    ),
  );
}
