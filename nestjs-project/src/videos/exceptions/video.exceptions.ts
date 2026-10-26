import { DomainException } from '../../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class VideoTooLargeException extends DomainException {
  constructor() {
    super('VIDEO_TOO_LARGE', 413, 'Video exceeds the maximum allowed size');
  }
}

export class UnsupportedVideoFormatException extends DomainException {
  constructor() {
    super('UNSUPPORTED_VIDEO_FORMAT', 415, 'Unsupported video format');
  }
}

export class InvalidUploadStateException extends DomainException {
  constructor() {
    super(
      'INVALID_UPLOAD_STATE',
      409,
      'Upload is not in progress for this video',
    );
  }
}

export class InvalidUploadPartsException extends DomainException {
  constructor() {
    super('INVALID_UPLOAD_PARTS', 400, 'Invalid upload parts');
  }
}

export class UploadSizeMismatchException extends DomainException {
  constructor() {
    super(
      'UPLOAD_SIZE_MISMATCH',
      409,
      'Uploaded file size does not match the declared size',
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready');
  }
}
