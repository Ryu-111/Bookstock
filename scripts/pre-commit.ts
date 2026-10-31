// 出典: Ryu-111/jev-router scripts/pre-commit.ts（同一作者、MIT）
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './process.js';
import type { Runner } from './process.js';

export async function preCommit(
  root: string,
  runner: Runner = run,
): Promise<void> {
  const git = async (args: string[]) => {
    const result = await runner('git', args, root, 10_000);
    if (result.status !== 0 || result.timedOut || result.truncated)
      throw new Error(`Git検証に失敗しました: ${result.output}`);
    return result.output;
  };
  const changed = (
    await git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
  )
    .split('\0')
    .filter(Boolean);
  const allChanges = await git(['diff', '--cached', '--name-only', '-z']);
  if (!allChanges) return;
  if (!existsSync(join(root, 'node_modules')))
    throw new Error('npm ciを実行してください');
  const snapshot = mkdtempSync(join(tmpdir(), 'bookstock-index-'));
  try {
    await git(['checkout-index', '--all', `--prefix=${snapshot}${sep}`]);
    symlinkSync(
      join(root, 'node_modules'),
      join(snapshot, 'node_modules'),
      'dir',
    );
    const check = async (command: string, args: string[]) => {
      const result = await runner(command, args, snapshot, 120_000);
      if (result.status !== 0 || result.timedOut) {
        throw new Error(
          `${command} ${args.join(' ')} に失敗${result.timedOut ? '（タイムアウト）' : ''}:\n${result.output}`,
        );
      }
    };
    if (changed.length > 0) {
      await check(process.execPath, [
        join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'),
        '--check',
        '--ignore-unknown',
        '--',
        ...changed,
      ]);
      const code = changed.filter((name) => /\.(?:tsx?|mjs|js)$/.test(name));
      if (code.length > 0)
        await check(process.execPath, [
          join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
          '--max-warnings=0',
          '--',
          ...code,
        ]);
    }
    await check('npm', ['run', 'typecheck']);
    await check('npm', ['test']);
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await preCommit(process.cwd());
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'pre-commit検証失敗',
    );
    process.exitCode = 1;
  }
}
