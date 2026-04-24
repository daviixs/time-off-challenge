import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

export function createSqliteAdapter(url?: string) {
  const datasourceUrl = url ?? process.env.DATABASE_URL;

  if (!datasourceUrl) {
    throw new Error('DATABASE_URL must be set before Prisma is constructed.');
  }

  return new PrismaBetterSqlite3({
    url: datasourceUrl,
  });
}
