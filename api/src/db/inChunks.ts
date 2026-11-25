// D1 は 1 文あたり束縛 100 個まで、1 リクエストあたり 50 クエリまで（db.batch は 1 クエリ扱い）。
// IN (...) を 100 個以内に分割し、全チャンクを 1 回の db.batch でまとめて引く。
const MAX_PARAMS = 100;

/**
 * `sql(marks)` は IN の中身（"?,?,?"）を受け取って SQL を返す。`lead` は IN より前に束縛する値。
 * 結果は全チャンク分を連結して返す。
 */
export async function selectIn<T>(
  db: D1Database,
  values: readonly string[],
  sql: (marks: string) => string,
  lead: readonly unknown[] = [],
): Promise<T[]> {
  if (values.length === 0) return [];
  const size = MAX_PARAMS - lead.length;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < values.length; i += size) {
    const part = values.slice(i, i + size);
    stmts.push(db.prepare(sql(part.map(() => "?").join(","))).bind(...lead, ...part));
  }
  const res = await db.batch(stmts);
  return res.flatMap((r) => r.results as T[]);
}
