import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
  type HttpRedirectResponse,
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
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadResponse } from './dto/initiate-upload-response.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PartUrlsResponse } from './dto/part-urls-response.dto';
import { RequestPartUrlsDto } from './dto/request-part-urls.dto';
import { UploadedPartsResponse } from './dto/uploaded-parts-response.dto';
import { VideoResponse } from './dto/video-response.dto';
import { VideosService } from './videos.service';
import type { PlaybackKind } from './videos.types';

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

const NOT_READY_RESPONSE = {
  status: 409,
  description: 'The video is not ready (still a draft, processing or failed)',
  schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
};

const redirectResponse = (target: string) => ({
  status: 302,
  description: `Redirect to a short-lived presigned URL of the ${target}`,
  headers: {
    Location: {
      description: `Presigned storage URL of the ${target}`,
      schema: { type: 'string', format: 'uri' },
    },
  },
});

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

  @Get(':publicId')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get a video',
    description:
      "Returns the caller's video with its processing status (draft → processing → ready | failed), including duration, metadata and failure reason once available.",
  })
  @ApiResponse({
    status: 200,
    description: 'The video and its current status',
    type: VideoResponse,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  async getVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<VideoResponse> {
    return this.videosService.getVideo(user.sub, publicId);
  }

  @Get(':publicId/stream')
  @Redirect()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Redirects to a short-lived presigned URL of the video file. The storage serves Range requests with 206 Partial Content, so playback starts without downloading the whole file.',
  })
  @ApiResponse(redirectResponse('video file'))
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  @ApiResponse(NOT_READY_RESPONSE)
  async streamVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<HttpRedirectResponse> {
    return this.playbackRedirect(user, publicId, 'stream');
  }

  @Get(':publicId/download')
  @Redirect()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Redirects to a short-lived presigned URL of the video file that answers with Content-Disposition: attachment and the original filename.',
  })
  @ApiResponse(redirectResponse('video file as an attachment'))
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  @ApiResponse(NOT_READY_RESPONSE)
  async downloadVideo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<HttpRedirectResponse> {
    return this.playbackRedirect(user, publicId, 'download');
  }

  @Get(':publicId/thumbnail')
  @Redirect()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get a video thumbnail',
    description:
      'Redirects to a short-lived presigned URL of the JPEG thumbnail generated during processing.',
  })
  @ApiResponse(redirectResponse('JPEG thumbnail'))
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  @ApiResponse(NOT_READY_RESPONSE)
  async getThumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<HttpRedirectResponse> {
    return this.playbackRedirect(user, publicId, 'thumbnail');
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

  @Post(':publicId/upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete an upload',
    description:
      'Completes the multipart upload, checks the stored size against the declared one, moves the video to processing and enqueues the processing job. Calling it again while the video is processing is a safe retry.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed; video is processing',
    type: VideoResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or the storage rejected the part list',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(NOT_FOUND_RESPONSE)
  @ApiResponse({
    status: 409,
    description:
      'Video already ready/failed, or stored size differs from the declared size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 413,
    description: 'Stored object exceeds the maximum allowed size',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<VideoResponse> {
    return this.videosService.completeUpload(user.sub, publicId, dto);
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

  private async playbackRedirect(
    user: JwtPayload,
    publicId: string,
    kind: PlaybackKind,
  ): Promise<HttpRedirectResponse> {
    const url = await this.videosService.getPlaybackUrl(
      user.sub,
      publicId,
      kind,
    );
    return { url, statusCode: HttpStatus.FOUND };
  }
}
