// Upload allowlist: file extension → the only MIME type accepted for it.
export const ALLOWED_VIDEO_FORMATS = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.avi': 'video/x-msvideo',
} as const;

export const MAX_PART_URLS_PER_REQUEST = 100;

export const MAX_PUBLIC_ID_ATTEMPTS = 5;

export const VIDEO_STORAGE_KEYS = {
  source: (videoId: string): string => `videos/${videoId}/source`,
  thumbnail: (videoId: string): string => `videos/${videoId}/thumbnail.jpg`,
} as const;
