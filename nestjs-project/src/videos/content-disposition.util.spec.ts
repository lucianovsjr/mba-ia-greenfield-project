import { attachmentDisposition } from './content-disposition.util';

describe('attachmentDisposition', () => {
  it('should keep a plain ASCII filename in both parameters', () => {
    expect(attachmentDisposition('clip.mp4')).toBe(
      `attachment; filename="clip.mp4"; filename*=UTF-8''clip.mp4`,
    );
  });

  it('should replace quotes and backslashes in the quoted fallback', () => {
    expect(attachmentDisposition('a"b\\c.mp4')).toBe(
      `attachment; filename="a_b_c.mp4"; filename*=UTF-8''a%22b%5Cc.mp4`,
    );
  });

  it('should keep non-ASCII names exact only in filename*', () => {
    expect(attachmentDisposition("férias (1)'s.mp4")).toBe(
      `attachment; filename="f_rias (1)'s.mp4"; filename*=UTF-8''f%C3%A9rias%20%281%29%27s.mp4`,
    );
  });

  it('should strip control characters that would break the header', () => {
    expect(attachmentDisposition('a\r\nb.mp4')).toBe(
      `attachment; filename="a__b.mp4"; filename*=UTF-8''a%0D%0Ab.mp4`,
    );
  });
});
