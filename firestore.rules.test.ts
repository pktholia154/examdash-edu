import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.join(process.cwd(), 'firestore.rules');

function readRules(): string {
  if (fs.existsSync(rulesPath)) {
    return fs.readFileSync(rulesPath, 'utf8');
  }
  const draftPath = path.join(process.cwd(), 'DRAFT_firestore.rules');
  return fs.readFileSync(draftPath, 'utf8');
}

test('Firestore rules enforce default-deny catch-all and rules_version 2', () => {
  const rules = readRules();
  assert.match(rules, /rules_version\s*=\s*'2';/);
  assert.match(rules, /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/);
});

test('Dirty Dozen: Catalog collections forbid client writes and enforce published non-deleted reads', () => {
  const rules = readRules();
  assert.match(rules, /match\s+\/books\/\{bookId\}/);
  assert.match(rules, /match\s+\/ExamPackDocument\/\{examId\}/);
  assert.match(rules, /resource\.data\.isPublished\s*==\s*true\s*&&\s*resource\.data\.isDeleted\s*==\s*false/);
  assert.match(rules, /allow\s+create,\s*update,\s*delete:\s*if\s+false;/);
});

test('Dirty Dozen: Verified email, strict key allowlists, temporal integrity, and PII split-collection', () => {
  const rules = readRules();
  assert.match(rules, /request\.auth\.token\.email_verified\s*==\s*true/);
  assert.match(rules, /hasOnly\(\[/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\[/);
  assert.match(rules, /createdAt\s*==\s*request\.time/);
  assert.match(rules, /updatedAt\s*==\s*request\.time/);
  assert.match(rules, /match\s+\/private\/\{infoId\}/);
  assert.match(rules, /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\)/);
  assert.match(rules, /existsAfter\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\)/);
});

test('Dirty Dozen: Completed purchases enforce terminal state immutability and Razorpay payment metadata', () => {
  const rules = readRules();
  assert.match(rules, /match\s+\/purchases\/\{purchaseId\}/);
  assert.match(rules, /data\.status\s*==\s*'completed'/);
  assert.match(rules, /data\.paymentProvider\s*==\s*'razorpay'/);
  assert.match(rules, /\^order_\[a-zA-Z0-9\]\+\$/);
  assert.match(rules, /\^pay_\[a-zA-Z0-9\]\+\$/);
  assert.match(rules, /allow\s+update,\s*delete:\s*if\s+false;/);
});

