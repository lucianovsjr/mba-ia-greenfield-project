import { execFile } from 'node:child_process';
import { ProcessExecutionError } from './media.errors';

export interface RunProcessOptions {
  timeoutMs: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: RunProcessOptions,
) => Promise<ProcessResult>;

// ffprobe JSON for files with many streams can exceed Node's 1 MiB default.
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

// execFile spawns the binary directly with an argument array — no shell, so
// file names with spaces or metacharacters reach the binary as a single argument.
export const runProcess: ProcessRunner = (command, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed === true && error.signal === 'SIGTERM';
          const exitCode = typeof error.code === 'number' ? error.code : null;
          reject(
            new ProcessExecutionError(
              command,
              exitCode,
              stderr || error.message,
              timedOut,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
