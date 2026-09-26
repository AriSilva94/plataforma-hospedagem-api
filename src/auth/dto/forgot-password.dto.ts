import { IsEmail } from 'class-validator';
import { NormalizeEmail } from '../../common/transforms';

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail()
  email!: string;
}
