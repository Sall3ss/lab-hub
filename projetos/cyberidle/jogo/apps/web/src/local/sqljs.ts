import type { Database as SqlJsDatabase } from 'sql.js';
import type { SqlDriver } from '../../../server/src/db.js';

/**
 * Adaptador do sql.js com a forma do `DatabaseSync` do `node:sqlite`, que e o que o
 * `Database` do servidor usa: exec, prepare(...).get/all/run e close.
 * Toda escrita chama `aoGravar`, para o modo local salvar o banco no navegador.
 * Lab Hub, Claude (Opus 5.5).
 */
type Param = string | number | null | Uint8Array;

export function criarDriver(db: SqlJsDatabase, aoGravar: () => void): SqlDriver {
  const consultar = (sql: string, params: Param[]): Record<string, unknown>[] => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params.map((p) => (typeof p === 'boolean' ? Number(p) : p ?? null)));
      const linhas: Record<string, unknown>[] = [];
      while (stmt.step()) linhas.push(stmt.getAsObject());
      return linhas;
    } finally {
      stmt.free();
    }
  };

  const driver = {
    exec(sql: string): void {
      db.exec(sql);
      if (!/^\s*(PRAGMA|SELECT)/i.test(sql)) aoGravar();
    },
    prepare(sql: string) {
      return {
        get: (...params: Param[]) => consultar(sql, params)[0],
        all: (...params: Param[]) => consultar(sql, params),
        run: (...params: Param[]) => {
          consultar(sql, params);
          const changes = db.getRowsModified();
          const id = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] ?? 0;
          aoGravar();
          return { changes, lastInsertRowid: Number(id) };
        },
      };
    },
    close(): void {
      db.close();
    },
  };
  return driver as unknown as SqlDriver;
}
