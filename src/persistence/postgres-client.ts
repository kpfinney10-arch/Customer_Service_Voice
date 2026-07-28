import type { QueryResult, QueryResultRow } from "pg";

export type PostgresQueryable = {
  query: <TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<TRow>>;
};

export type PostgresConnection = PostgresQueryable & {
  release: () => void;
};

export type PostgresDatabase = PostgresQueryable & {
  connect: () => Promise<PostgresConnection>;
  end: () => Promise<void>;
};
