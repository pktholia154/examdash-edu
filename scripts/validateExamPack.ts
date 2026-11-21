import fs from 'node:fs';
import path from 'node:path';
import { validateExamPack } from '../lib/exam/validator';
import { BENCHMARK_SET_1 } from '../lib/exam/benchmark-packs';

/**
 * Authoring-Time CI Validator for ExamSet[] JSON Packs (Master Pillar 10 — Zero-AI Runtime).
 * Usage:
 *   npx --yes tsx scripts/validateExamPack.ts [optional-path-to-exam-pack.json]
 */
function main() {
  const argPath = process.argv[2];
  let payload: unknown;
  let sourceLabel: string;

  if (argPath) {
    const resolved = path.resolve(process.cwd(), argPath);
    sourceLabel = resolved;
    const rawText = fs.readFileSync(resolved, 'utf8');
    payload = JSON.parse(rawText);
  } else {
    sourceLabel = 'Built-in BENCHMARK_SET_1';
    payload = [BENCHMARK_SET_1];
  }

  const result = validateExamPack(payload);

  if (!result.valid) {
    console.error(`[FAIL] ExamPack validation failed for ${sourceLabel}:`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    console.warn(`[WARN] ${result.warnings.length} warning(s):`);
    for (const w of result.warnings) {
      console.warn(`  - ${w}`);
    }
  }

  console.log(`[PASS] Zero-Drift Invariants Verified for ${sourceLabel}`);
  console.log(
    JSON.stringify(result.derivedMetadata, null, 2)
  );
}

main();
