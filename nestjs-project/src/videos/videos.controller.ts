import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { InitiateUploadResponse } from './dto/initiate-upload-response.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PartUrlsResponse } from './dto/part-urls-response.dto';
import { RequestPartUrlsDto } from './dto/request-part-urls.dto';
import { UploadedPartsResponse } from './dto/uploaded-parts-response.dto';
import { VideosService } from './videos.service';

const NOT_FOUND_RESPONSE = {
  status: 404,
  description: "Video not found or owned by another user's channel",
  schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
};

const NOT_DRAFT_RESPONSE = {
  status: 409,
  description: 'The video is not in draft status (upload not in progress)',
  schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
};

const UNAUTHORIZED_RESPONSE = {
  status: 401,
  description: 'Missing or invalid access token',
  schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
};

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      "Pre-registers the video as a draft in the caller's channel and opens a multipart upload in object storage. The file bytes are then sent directly to storage through presigned part URLs.",
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created and multipart upload opened',
    type: InitiateUploadResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'Declared size exceeds the maximum allowed size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 415,
    description:
      'File extension or content type outside the allowlist, or mismatched',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponse> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Post(':publicId/upload/part-urls')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get presigned URLs for upload parts',
    description:
      'Issues presigned UploadPart URLs for the requested part numbers. Can be called again at any time while the video is a draft, which is how an interrupted upload resumes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URLs',
    type: PartUrlsResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or part number above the part count',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  @ApiResponse(NOT_DRAFT_RESPONSE)
  async requestPartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: RequestPartUrlsDto,
  ): Promise<PartUrlsResponse> {
    return this.videosService.requestPartUrls(user.sub, publicId, dto);
  }

  @Get(':publicId/upload/parts')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List uploaded parts',
    description:
      'Lists the parts already stored for the in-progress upload, so a client can resume by sending only the missing ones.',
  })
  @ApiResponse({
    status: 200,
    description: 'Parts already stored',
    type: UploadedPartsResponse,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  @ApiResponse(NOT_DRAFT_RESPONSE)
  async listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<UploadedPartsResponse> {
    return this.videosService.listUploadedParts(user.sub, publicId);
  }

  @Delete(':publicId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Abort an upload',
    description:
      'Aborts the multipart upload in storage and deletes the draft video.',
  })
  @ApiResponse({ status: 204, description: 'Upload aborted and draft deleted' })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  @ApiResponse(NOT_DRAFT_RESPONSE)
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<void> {
    await this.videosService.abortUpload(user.sub, publicId);
  }
}
