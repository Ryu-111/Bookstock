// 出典: Ryu-111/jev-router scripts/process.ts（同一作者、MIT）
import { spawn } from 'node:child_process';

export interface Result {
  status: number | null;
  output: string;
  timedOut: boolean;
  truncated?: boolean;
}

export type Runner = (
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
) => Promise<Result>;

// shellを介さず引数を渡す。タイムアウト時はnpmの子プロセスも終了する。
export const run: Runner = (command, args, cwd, timeout) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    let truncated = false;
    const collect = (data: Buffer) => {
      output += data.toString();
      if (output.length > 4_194_304) {
        truncated = true;
        output = output.slice(-4_194_304);
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => {
      output = (output + error.message).slice(-16_384);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(
            process.platform === 'win32' ? child.pid : -child.pid,
            'SIGKILL',
          );
        } catch {
          // 終了とタイムアウトが同時に発生した場合。
        }
      }
    }, timeout);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, output, timedOut, truncated });
    });
  });
