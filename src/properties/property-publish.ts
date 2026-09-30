export const PUBLISH_REQUIREMENTS = [
  'DESCRIPTION',
  'ADDRESS',
  'PHOTO',
  'ROOM',
] as const;

export type PublishRequirement = (typeof PUBLISH_REQUIREMENTS)[number];

export const publishRequirementLabels: Record<PublishRequirement, string> = {
  DESCRIPTION: 'descrição',
  ADDRESS: 'endereço completo',
  PHOTO: 'ao menos uma foto',
  ROOM: 'ao menos um quarto não inativo',
};

interface PublishSnapshot {
  description: string | null;
  postalCode: string | null;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  imageCount: number;
  listableRoomCount: number;
}

export function missingPublishRequirements(
  snapshot: PublishSnapshot,
): PublishRequirement[] {
  const hasAddress = Boolean(
    snapshot.postalCode &&
    snapshot.street &&
    snapshot.number &&
    snapshot.neighborhood &&
    snapshot.city &&
    snapshot.state,
  );
  const missing: Record<PublishRequirement, boolean> = {
    DESCRIPTION: !snapshot.description,
    ADDRESS: !hasAddress,
    PHOTO: snapshot.imageCount === 0,
    ROOM: snapshot.listableRoomCount === 0,
  };
  return PUBLISH_REQUIREMENTS.filter((requirement) => missing[requirement]);
}
