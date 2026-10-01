export const COMPLETENESS_WEIGHTS = {
  ROOM_DESCRIPTION: 20,
  ROOM_PHOTOS: 20,
  ROOM_AMENITIES: 10,
  ROOM_ADDITIONAL_INFO: 5,
  PROPERTY_DESCRIPTION: 10,
  PROPERTY_PHOTOS: 10,
  PROPERTY_FEATURES: 5,
  HOUSE_RULES: 5,
  GENERAL_INFO: 5,
  SHARED_AREAS: 5,
  REFERENCE_POINTS: 5,
} as const;

export type CompletenessCriterion = keyof typeof COMPLETENESS_WEIGHTS;

export const COMPLETENESS_CRITERIA = Object.keys(
  COMPLETENESS_WEIGHTS,
) as CompletenessCriterion[];

export const PROPERTY_COMPLETENESS_FIELDS = [
  'description',
  'houseRules',
  'generalInfo',
  'features',
  'referencePoints',
] as const;

export interface CompletenessSnapshot {
  room: {
    description: string | null;
    amenities: string[];
    additionalInfo: string | null;
    imageCount: number;
  };
  property: {
    description: string | null;
    houseRules: string | null;
    generalInfo: string | null;
    features: string[];
    referencePoints: string[];
    sharedAreaCount: number;
    imageCount: number;
  };
}

export interface Completeness {
  score: number;
  missing: CompletenessCriterion[];
}

export function evaluateCompleteness({
  room,
  property,
}: CompletenessSnapshot): Completeness {
  const met: Record<CompletenessCriterion, boolean> = {
    ROOM_DESCRIPTION: Boolean(room.description),
    ROOM_PHOTOS: room.imageCount > 0,
    ROOM_AMENITIES: room.amenities.length > 0,
    ROOM_ADDITIONAL_INFO: Boolean(room.additionalInfo),
    PROPERTY_DESCRIPTION: Boolean(property.description),
    PROPERTY_PHOTOS: property.imageCount > 0,
    PROPERTY_FEATURES: property.features.length > 0,
    HOUSE_RULES: Boolean(property.houseRules),
    GENERAL_INFO: Boolean(property.generalInfo),
    SHARED_AREAS: property.sharedAreaCount > 0,
    REFERENCE_POINTS: property.referencePoints.length > 0,
  };

  const total = sumWeights(COMPLETENESS_CRITERIA);
  const achieved = sumWeights(
    COMPLETENESS_CRITERIA.filter((criterion) => met[criterion]),
  );

  return {
    score: Math.round((achieved * 100) / total),
    missing: COMPLETENESS_CRITERIA.filter((criterion) => !met[criterion]),
  };
}

function sumWeights(criteria: CompletenessCriterion[]): number {
  return criteria.reduce(
    (sum, criterion) => sum + COMPLETENESS_WEIGHTS[criterion],
    0,
  );
}
