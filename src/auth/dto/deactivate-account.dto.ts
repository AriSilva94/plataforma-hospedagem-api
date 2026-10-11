import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DeactivateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword?: string;
}
