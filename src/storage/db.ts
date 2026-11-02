import { SCHEMA_VERSION } from '../domain/book.js';
import type {
  Book,
  BookCandidate,
  ExportFile,
  Format,
  NewRecord,
  ReadingLog,
  ReadingRecord,
} from '../domain/book.js';
import { estimateMinutes } from '../domain/audio.js';
import { changeFormat } from '../domain/manual.js';
import type { NewLog } from '../domain/manual.js';
import {
  validateBook,
  validateExport,
  validateLog,
  validateRecord,
} from '../domain/validate.js';
import type { Validation } from '../domain/validate.js';

const DB_VERSION = 1;
type StoreName = 'books' | 'records' | 'logs';
const STORES: StoreName[] = ['books', 'records', 'logs'];

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDBの操作に失敗しました'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new Error('トランザクションが中断されました'));
    tx.onerror = () =>
      reject(tx.error ?? new Error('トランザクションに失敗しました'));
  });
}

/** 途中で失敗したトランザクションを中断する。すでに終わっていれば何もしない。 */
async function rollback(tx: IDBTransaction, completed: Promise<void>) {
  try {
    tx.abort();
  } catch {
    // すでにcommitまたはabort済み
  }
  await completed.catch(() => undefined);
}

export function openDb(
  factory: IDBFactory,
  name = 'bookstock',
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const books = db.createObjectStore('books', { keyPath: 'id' });
      books.createIndex('isbn13', 'isbn13');
      const records = db.createObjectStore('records', { keyPath: 'id' });
      records.createIndex('bookId', 'bookId');
      records.createIndex('status', 'status');
      records.createIndex('finishedAt', 'finishedAt');
      const logs = db.createObjectStore('logs', { keyPath: 'id' });
      logs.createIndex('recordId', 'recordId');
      logs.createIndex('date', 'date');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDBを開けません'));
    request.onblocked = () =>
      reject(new Error('別のタブがデータベースを使用中です'));
  });
}

export type { NewRecord } from '../domain/book.js';

export type ImportMode = 'replace' | 'merge';

export interface Clock {
  now(): Date;
  id(): string;
}

const systemClock: Clock = {
  now: () => new Date(),
  id: () => crypto.randomUUID(),
};

/** 書き込む値を検証する。不正なら書き込まずに例外にする。 */
function valid<T>(result: Validation<T>): T {
  if (!result.ok)
    throw new Error(`入力が正しくありません: ${result.errors.join('; ')}`);
  return result.value;
}

/** 読み出した値を検証する。壊れたデータを画面に流さない。 */
function checked(snapshot: ExportFile): ExportFile {
  const result = validateExport(snapshot);
  if (!result.ok)
    throw new Error(
      `保存データが壊れています: ${result.errors.slice(0, 3).join('; ')}`,
    );
  return result.value;
}

export class Repository {
  constructor(
    private readonly db: IDBDatabase,
    private readonly clock: Clock = systemClock,
  ) {}

  private async getAll(tx: IDBTransaction): Promise<ExportFile> {
    const [books, records, logs] = await Promise.all(
      STORES.map((name) => promisify(tx.objectStore(name).getAll())),
    );
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: this.clock.now().toISOString(),
      books: books as Book[],
      records: records as ReadingRecord[],
      logs: logs as ReadingLog[],
    };
  }

  /** 全データを検証して返す（エクスポート・画面表示の両方に使う）。 */
  async snapshot(): Promise<ExportFile> {
    const tx = this.db.transaction(STORES, 'readonly');
    const [data] = await Promise.all([this.getAll(tx), done(tx)]);
    return checked(data);
  }

  /**
   * 候補を保存して読書記録を追加する。同じISBNの本があれば、本は再利用する。
   * 本と記録は1つのトランザクションで書く。
   */
  async addRecord(
    candidate: BookCandidate,
    input: NewRecord,
  ): Promise<{ book: Book; record: ReadingRecord }> {
    const tx = this.db.transaction(['books', 'records'], 'readwrite');
    const completed = done(tx);
    try {
      const books = tx.objectStore('books');
      const existing = candidate.isbn13
        ? ((await promisify(books.index('isbn13').get(candidate.isbn13))) as
            Book | undefined)
        : undefined;
      const book: Book = existing ?? { ...candidate, id: this.clock.id() };
      if (!existing) books.add(book);
      const now = this.clock.now().toISOString();
      const record: ReadingRecord = {
        id: this.clock.id(),
        bookId: book.id,
        tags: [],
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      tx.objectStore('records').add(record);
      await completed;
      return { book, record };
    } catch (error) {
      await rollback(tx, completed);
      throw error;
    }
  }

  /** 1つのトランザクションで書き込む。失敗したら中断して例外を投げ直す。 */
  private async write<T>(
    stores: StoreName[],
    fn: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = this.db.transaction(stores, 'readwrite');
    const completed = done(tx);
    try {
      const result = await fn(tx);
      await completed;
      return result;
    } catch (error) {
      await rollback(tx, completed);
      throw error;
    }
  }

  private async getRecord(
    tx: IDBTransaction,
    id: string,
  ): Promise<ReadingRecord> {
    const found: unknown = await promisify(tx.objectStore('records').get(id));
    if (found === undefined) throw new Error('記録が見つかりません');
    return valid(validateRecord(found, 'records'));
  }

  /** 既存の本に、新しい形式の記録を追加する（ISBNのない本にも使える）。 */
  addRecordForBook(bookId: string, input: NewRecord): Promise<ReadingRecord> {
    return this.write(['books', 'records'], async (tx) => {
      const book: unknown = await promisify(
        tx.objectStore('books').get(bookId),
      );
      if (book === undefined) throw new Error('本が見つかりません');
      const now = this.clock.now().toISOString();
      const record: ReadingRecord = {
        id: this.clock.id(),
        bookId,
        tags: [],
        createdAt: now,
        updatedAt: now,
        ...input,
      };
      tx.objectStore('records').add(valid(validateRecord(record, 'record')));
      return record;
    });
  }

  /** 記録を置き換える。本とidは変えられない。updatedAtを今にする。 */
  updateRecord(record: ReadingRecord): Promise<ReadingRecord> {
    return this.write(['records'], async (tx) => {
      const current = await this.getRecord(tx, record.id);
      if (current.bookId !== record.bookId)
        throw new Error('記録の本は変更できません');
      const next = valid(
        validateRecord(
          {
            ...record,
            createdAt: current.createdAt,
            updatedAt: this.clock.now().toISOString(),
          },
          'record',
        ),
      );
      tx.objectStore('records').put(next);
      return next;
    });
  }

  /**
   * 複数の記録の形式をまとめて変える。1件でも見つからない・不正なら何も書かない。
   * 変更した件数を返す。
   */
  changeFormat(
    ids: readonly string[],
    format: Format,
    platform?: string,
    /** オーディオにするとき、長さが空の記録にページ数からの推定値を入れる */
    fillEstimate = false,
  ): Promise<number> {
    return this.write(['records', 'books'], async (tx) => {
      const now = this.clock.now().toISOString();
      const next: ReadingRecord[] = [];
      for (const id of new Set(ids)) {
        const current = await this.getRecord(tx, id);
        let estimate: number | undefined;
        if (fillEstimate && format === 'audiobook' && !current.totalMinutes) {
          const book: unknown = await promisify(
            tx.objectStore('books').get(current.bookId),
          );
          const checked =
            book === undefined ? undefined : validateBook(book, 'book');
          estimate = checked?.ok
            ? estimateMinutes(checked.value.pageCount)
            : undefined;
        }
        next.push(
          valid(
            validateRecord(
              {
                ...changeFormat(current, format, platform, estimate),
                updatedAt: now,
              },
              'record',
            ),
          ),
        );
      }
      for (const record of next) tx.objectStore('records').put(record);
      return next.length;
    });
  }

  /** 本の情報を置き換える。 */
  updateBook(book: Book): Promise<Book> {
    return this.write(['books'], async (tx) => {
      const store = tx.objectStore('books');
      if ((await promisify(store.get(book.id))) === undefined)
        throw new Error('本が見つかりません');
      const next = valid(validateBook(book, 'book'));
      store.put(next);
      return next;
    });
  }

  /** 進捗ログを追加し、記録のupdatedAtも更新する。 */
  addLog(recordId: string, input: NewLog): Promise<ReadingLog> {
    return this.write(['records', 'logs'], async (tx) => {
      const record = await this.getRecord(tx, recordId);
      const log = valid(
        validateLog({ ...input, id: this.clock.id(), recordId }, 'log'),
      );
      tx.objectStore('logs').add(log);
      tx.objectStore('records').put({
        ...record,
        updatedAt: this.clock.now().toISOString(),
      });
      return log;
    });
  }

  deleteLog(id: string): Promise<void> {
    return this.write(['logs'], async (tx) => {
      await promisify(tx.objectStore('logs').delete(id));
    });
  }

  /** 記録とその進捗ログを削除する。どの記録からも参照されない本も削除する。 */
  async deleteRecord(id: string): Promise<void> {
    const tx = this.db.transaction(STORES, 'readwrite');
    const completed = done(tx);
    try {
      const records = tx.objectStore('records');
      const logs = tx.objectStore('logs');
      const record = (await promisify(records.get(id))) as
        ReadingRecord | undefined;
      if (record) {
        records.delete(id);
        for (const key of await promisify(
          logs.index('recordId').getAllKeys(id),
        ))
          logs.delete(key);
        const siblings = await promisify(
          records.index('bookId').getAllKeys(record.bookId),
        );
        if (siblings.every((key) => key === id))
          tx.objectStore('books').delete(record.bookId);
      }
      await completed;
    } catch (error) {
      await rollback(tx, completed);
      throw error;
    }
  }

  /**
   * 検証済みのファイルを書き込む。replaceは全消去してから、mergeは同じidを上書きする。
   * mergeの結果も参照の整合性を確かめ、問題があれば何も書かない。
   */
  async importFile(file: ExportFile, mode: ImportMode): Promise<void> {
    const input = checked(file);
    const tx = this.db.transaction(STORES, 'readwrite');
    const completed = done(tx);
    try {
      let next = input;
      if (mode === 'merge') {
        const current = await this.getAll(tx);
        const byId = <T extends { id: string }>(a: T[], b: T[]) => [
          ...new Map([...a, ...b].map((item) => [item.id, item])).values(),
        ];
        next = checked({
          ...current,
          books: byId(current.books, input.books),
          records: byId(current.records, input.records),
          logs: byId(current.logs, input.logs),
        });
      }
      for (const name of STORES) tx.objectStore(name).clear();
      for (const book of next.books) tx.objectStore('books').put(book);
      for (const record of next.records) tx.objectStore('records').put(record);
      for (const log of next.logs) tx.objectStore('logs').put(log);
      await completed;
    } catch (error) {
      await rollback(tx, completed);
      throw error;
    }
  }
}
