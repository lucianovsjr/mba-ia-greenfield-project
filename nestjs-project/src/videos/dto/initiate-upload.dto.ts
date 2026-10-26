import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class InitiateUploadDto {
  /** Video title shown to the owner; editable later (Phase 04). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  /** Original file name; its extension must be .mp4, .mov, .mpg, .mpeg or .avi. */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename: string;

  /** File size in bytes (at most 10 GiB). */
  @IsInt()
  @Min(1)
  size: number;

  /** MIME type matching the file extension (e.g. video/mp4). */
  @IsString()
  @IsNotEmpty()
  contentType: string;
}
