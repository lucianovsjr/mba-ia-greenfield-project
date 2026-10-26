export class ProcessExecutionError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly timedOut: boolean,
  ) {
    super(
      timedOut
        ? `${command} timed out`
        : `${command} exited with code ${exitCode ?? 'unknown'}: ${stderr.trim()}`,
    );
    this.name = 'ProcessExecutionError';
  }
}

// The input is not a decodable video: corrupted/unsupported data or no video stream.
// Not retryable — the same file always fails the same way.
export class InvalidMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMediaError';
  }
}
