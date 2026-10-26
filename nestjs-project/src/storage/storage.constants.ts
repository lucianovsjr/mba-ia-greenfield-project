export const STORAGE_S3_CLIENT = 'STORAGE_S3_CLIENT' as const;
export const STORAGE_PRESIGN_CLIENT = 'STORAGE_PRESIGN_CLIENT' as const;

export const STORAGE_PARTS_REJECTED_ERROR_NAMES = [
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
  'NoSuchUpload',
] as const;
