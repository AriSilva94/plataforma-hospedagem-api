import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PublicPropertyQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  checkIn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  checkOut?: string;
}
