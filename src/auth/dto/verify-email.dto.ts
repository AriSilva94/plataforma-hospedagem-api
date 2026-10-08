import { IsHexadecimal, IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @IsHexadecimal()
  @Length(64, 64)
  token!: string;
}
