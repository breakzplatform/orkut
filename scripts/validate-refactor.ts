/**
 * Throwaway local validation for the label.ts refactor.
 * Runs label() against an isolated COPY of the production labels.db
 * (from ../orkut-bkp) — no firehose, no network, no VM, backup untouched.
 *
 *   npx tsx scripts/validate-refactor.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "libsql";

const repoRoot = process.cwd();
const backupDir = path.resolve(repoRoot, "../orkut-bkp");

const NON_SUPPORTER = "did:plc:zzzzzzzzzzzzzzzzzzzzzzzz";
const TEST_SUPPORTER = "did:plc:yyyyyyyyyyyyyyyyyyyyyyyy";
const TEST_SUPPORTER_LABELS = ["fa", "syngred", "superlegal"];

const PREFIXES = ["", "muito", "super"];
const CATEGORIES = ["confiavel", "legal", "sexy"];
const DEFAULT9 = new Set(
  PREFIXES.flatMap((p) => CATEGORIES.map((c) => `${p}${c}`))
);

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const setEq = (a: Set<string>, b: string[]) =>
  a.size === b.length && b.every((v) => a.has(v));

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "orkut-validate-"));

const activeLabels = (db: InstanceType<typeof Database>, did: string) => {
  const rows = db
    .prepare(`SELECT val, neg FROM labels WHERE uri = ? ORDER BY id`)
    .all(did) as Array<{ val: string; neg: number | boolean }>;
  const set = new Set<string>();
  for (const r of rows) {
    if (r.neg) set.delete(r.val);
    else set.add(r.val);
  }
  return set;
};

const main = async () => {
  for (const f of ["labels.db", "labels.db-wal", "labels.db-shm"]) {
    const src = path.join(backupDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(sandbox, f));
  }
  fs.copyFileSync(path.join(backupDir, "env-orkut"), path.join(sandbox, ".env"));

  const supporters = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "supporters.json"), "utf8")
  );
  supporters[TEST_SUPPORTER] = TEST_SUPPORTER_LABELS;
  fs.writeFileSync(
    path.join(sandbox, "supporters.json"),
    JSON.stringify(supporters, null, 2)
  );

  process.chdir(sandbox);

  // Pre-flight: the synthetic DIDs must not already exist in the dataset,
  // otherwise the idempotency assertions would be meaningless.
  const probe = new Database(path.join(sandbox, "labels.db"));
  for (const did of [NON_SUPPORTER, TEST_SUPPORTER]) {
    const n = (
      probe
        .prepare(`SELECT count(*) AS c FROM labels WHERE uri = ?`)
        .get(did) as { c: number }
    ).c;
    if (n !== 0) {
      console.error(`Abort: ${did} already has ${n} rows; pick another.`);
      process.exit(2);
    }
  }
  probe.close();

  const { RUN, DELETE } = await import(
    pathToFileURL(path.join(repoRoot, "src/constants.ts")).href
  );
  const { label } = await import(
    pathToFileURL(path.join(repoRoot, "src/label.ts")).href
  );

  const db = new Database(path.join(sandbox, "labels.db"));

  // S1: non-supporter, first RUN → exactly 3 default labels, one per category
  await label(NON_SUPPORTER, RUN);
  const a1 = activeLabels(db, NON_SUPPORTER);
  const cats1 = new Set(
    [...a1].map((v) => CATEGORIES.find((c) => v.endsWith(c)))
  );
  check(
    "S1 random trio aplicado",
    a1.size === 3 && [...a1].every((v) => DEFAULT9.has(v)) && cats1.size === 3,
    [...a1].join(", ")
  );

  // S2: like RUN again → idempotent (the bug fix)
  await label(NON_SUPPORTER, RUN);
  const a2 = activeLabels(db, NON_SUPPORTER);
  check(
    "S2 RUN repetido NAO acumula",
    a2.size === 3 && setEq(a2, [...a1]),
    `${a2.size} labels: ${[...a2].join(", ")}`
  );

  // S3: DELETE → tudo negado
  await label(NON_SUPPORTER, DELETE);
  const a3 = activeLabels(db, NON_SUPPORTER);
  const negCount = (
    db
      .prepare(`SELECT count(*) AS c FROM labels WHERE uri = ? AND neg = 1`)
      .get(NON_SUPPORTER) as { c: number }
  ).c;
  check("S3 DELETE negou tudo", a3.size === 0 && negCount >= 3, `neg=${negCount}`);

  // S4: supporter → exatamente a lista do supporters.json
  await label(TEST_SUPPORTER, RUN);
  const a4 = activeLabels(db, TEST_SUPPORTER);
  check(
    "S4 supporter recebe lista exata",
    setEq(a4, TEST_SUPPORTER_LABELS),
    [...a4].join(", ")
  );

  // S5: supporter re-like → sem duplicar
  await label(TEST_SUPPORTER, RUN);
  const a5 = activeLabels(db, TEST_SUPPORTER);
  const rowCount = (
    db
      .prepare(`SELECT count(*) AS c FROM labels WHERE uri = ? AND neg = 0`)
      .get(TEST_SUPPORTER) as { c: number }
  ).c;
  check(
    "S5 supporter re-like idempotente",
    setEq(a5, TEST_SUPPORTER_LABELS) && rowCount === TEST_SUPPORTER_LABELS.length,
    `${rowCount} linhas positivas`
  );

  db.close();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
};

main()
  .catch((err) => {
    console.error("Harness error:", err);
    fail++;
  })
  .finally(() => {
    try {
      fs.rmSync(sandbox, { recursive: true, force: true });
    } catch {}
    process.exit(fail > 0 ? 1 : 0);
  });
