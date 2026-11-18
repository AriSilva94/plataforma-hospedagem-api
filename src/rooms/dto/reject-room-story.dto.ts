import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectRoomStoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
