import {
  COMPLETENESS_CRITERIA,
  COMPLETENESS_WEIGHTS,
  CompletenessSnapshot,
  evaluateCompleteness,
} from './room-completeness';

const empty: CompletenessSnapshot = {
  room: {
    description: null,
    amenities: [],
    additionalInfo: null,
    imageCount: 0,
  },
  property: {
    description: null,
    houseRules: null,
    generalInfo: null,
    features: [],
    referencePoints: [],
    sharedAreaCount: 0,
    imageCount: 0,
  },
};

const complete: CompletenessSnapshot = {
  room: {
    description: 'Suíte arejada.',
    amenities: ['DESK'],
    additionalInfo: 'Check-in após as 14h.',
    imageCount: 3,
  },
  property: {
    description: 'Casa ampla.',
    houseRules: 'Silêncio após 22h.',
    generalInfo: 'Wi-Fi na sala.',
    features: ['WIFI'],
    referencePoints: ['Metrô'],
    sharedAreaCount: 2,
    imageCount: 5,
  },
};

describe('evaluateCompleteness', () => {
  it('retorna 0 e todos os critérios pendentes para um anúncio vazio', () => {
    expect(evaluateCompleteness(empty)).toEqual({
      score: 0,
      missing: COMPLETENESS_CRITERIA,
    });
  });

  it('retorna 100 sem pendências para um anúncio completo', () => {
    expect(evaluateCompleteness(complete)).toEqual({ score: 100, missing: [] });
  });

  it('soma os pesos dos critérios atendidos, normalizado em 0 a 100', () => {
    const result = evaluateCompleteness({
      ...empty,
      room: { ...empty.room, description: 'Quarto.', imageCount: 1 },
      property: { ...empty.property, description: 'Casa.' },
    });
    const total = COMPLETENESS_CRITERIA.reduce(
      (sum, criterion) => sum + COMPLETENESS_WEIGHTS[criterion],
      0,
    );
    const achieved =
      COMPLETENESS_WEIGHTS.ROOM_DESCRIPTION +
      COMPLETENESS_WEIGHTS.ROOM_PHOTOS +
      COMPLETENESS_WEIGHTS.PROPERTY_DESCRIPTION;

    expect(result.score).toBe(Math.round((achieved * 100) / total));
    expect(result.missing).not.toContain('ROOM_DESCRIPTION');
    expect(result.missing).not.toContain('ROOM_PHOTOS');
    expect(result.missing).not.toContain('PROPERTY_DESCRIPTION');
    expect(result.missing).toContain('HOUSE_RULES');
  });

  it('considera dados do imóvel na completude do quarto', () => {
    const withoutSharedAreas = evaluateCompleteness({
      ...complete,
      property: { ...complete.property, sharedAreaCount: 0 },
    });

    expect(withoutSharedAreas.score).toBeLessThan(100);
    expect(withoutSharedAreas.missing).toEqual(['SHARED_AREAS']);
  });
});
