import { ValidateIf } from 'class-validator';

export const OptionalNonNull = () =>
  ValidateIf((_, value: unknown) => value !== undefined);
