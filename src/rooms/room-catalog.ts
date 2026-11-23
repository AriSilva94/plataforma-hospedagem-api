export const ROOM_AMENITIES = [
  'AIR_CONDITIONING',
  'FAN',
  'WARDROBE',
  'DESK',
  'TV',
  'MINIBAR',
  'WINDOW',
  'BALCONY',
  'BLACKOUT_CURTAINS',
  'DOOR_LOCK',
  'BED_LINEN',
  'TOWELS',
  'SAFE',
  'HAIR_DRYER',
] as const;

export const MAX_ROOM_IMAGES = 20;
export const MAX_ROOM_VIDEOS = 3;
export const MAX_ROOM_STORY_MEDIA = 3;
export const ROOM_STORY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ROOM_CAPACITY = 20;
export const MAX_BED_QUANTITY = 10;
export const MAX_PRICE_CENTS = 10_000_000;

export const bedSelection = {
  select: { type: true, quantity: true },
  orderBy: { type: 'asc' },
} as const;
