import { SCHEMA_VERSION } from '../domain/book.js';
import type { ExportFile } from '../domain/book.js';
import { isObject } from '../domain/guard.js';
import { validateExport } from '../domain/validate.js';
import type { Validation } from '../domain/validate.js';

/**
 * インポートするファイルの本文を検証する。
 * schemaVersionが上がったら、ここで古い形式を最新へ移行してから検証する。
 */
export function parseExportFile(body: string): Validation<ExportFile> {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, errors: ['JSONとして読み込めません'] };
  }
  if (isObject(data) && typeof data.schemaVersion === 'number') {
    if (data.schemaVersion > SCHEMA_VERSION)
      return {
        ok: false,
        errors: [
          `新しいバージョン（schemaVersion ${data.schemaVersion}）のファイルです。アプリを更新してください`,
        ],
      };
  }
  return validateExport(data);
}

export function exportFileName(now: Date): string {
  return `bookstock-${now.toISOString().slice(0, 10)}.json`;
}
