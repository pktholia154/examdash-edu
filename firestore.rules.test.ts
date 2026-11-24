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

test('Dirty Dozen: Completed purchases enforce validity bounds, expiry-gated renewal/deletion, and Razorpay payment metadata', () => {
  const rules = readRules();
  assert.match(rules, /match\s+\/purchases\/\{purchaseId\}/);
  assert.match(rules, /data\.status\s*==\s*'completed'/);
  assert.match(rules, /data\.paymentProvider\s*==\s*'razorpay'/);
  assert.match(rules, /\^order_\[a-zA-Z0-9\]\+\$/);
  assert.match(rules, /\^pay_\[a-zA-Z0-9\]\+\$/);
  assert.match(rules, /function\s+isValidPurchaseExpiryWindow\(data\)/);
  assert.match(rules, /function\s+isPurchaseExpired\(docData\)/);
  assert.match(rules, /data\.validityMonths\s*==\s*1/);
  assert.match(rules, /data\.validityMonths\s*==\s*6/);
  assert.match(rules, /data\.validityMonths\s*==\s*3/);
  assert.match(rules, /data\.validityMonths\s*==\s*24/);
  assert.match(rules, /allow\s+update:\s*if\s*\([\s\S]*isPurchaseExpired\(existing\(\)\)/);
  assert.match(rules, /allow\s+delete:\s*if[\s\S]*isPurchaseExpired\(existing\(\)\)/);
});

test('Dirty Dozen: ItemReview rules enforce deterministic 1-review-per-user ID, 1..5 integer rating, zero PII, and verified purchase proof', () => {
  const rules = readRules();
  assert.match(rules, /match\s+\/reviews\/\{reviewId\}/);
  assert.match(rules, /isValidItemReview\(incoming\(\),\s*reviewId\)/);
  assert.match(rules, /data\.reviewId\s*==\s*data\.collectionName\s*\+\s*'_'\s*\+\s*data\.itemId\s*\+\s*'_'\s*\+\s*data\.userId/);
  assert.match(rules, /data\.rating\s+is\s+int[\s\S]*data\.rating\s*>=\s*1[\s\S]*data\.rating\s*<=\s*5/);
  assert.match(rules, /resource\.data\.status\s*==\s*'published'/);
  assert.match(rules, /hasValidReviewPurchaseProof\(incoming\(\)\)/);
});

test('Dirty Dozen: UserExamAttempt rules enforce owner isolation, bounded telemetry arrays/maps, score immutability, and SaveAttemptFeedback updates', () => {
  const rules = readRules();
  assert.match(rules, /match\s+\/examAttempts\/\{attemptId\}/);
  assert.match(rules, /isValidUserExamAttempt\(incoming\(\),\s*attemptId\)/);
  assert.match(rules, /isValidPerformanceInsights\(data\.performanceInsights\)/);
  assert.match(rules, /data\.sectionBreakdown\s+is\s+list[\s\S]*data\.sectionBreakdown\.size\(\)\s*<=\s*30/);
  assert.match(rules, /data\.questionBreakdown\s+is\s+list[\s\S]*data\.questionBreakdown\.size\(\)\s*<=\s*500/);
  assert.match(rules, /incoming\(\)\.totalScore\s*==\s*existing\(\)\.totalScore/);
  assert.match(
    rules,
    /affectedKeys\(\)\.hasOnly\(\[\s*'perceivedDifficulty',\s*'pacingFeedback',\s*'reflectionNote',\s*'updatedAt'\s*\]\)/
  );
});

test('Dirty Dozen: UserWishlistItem rules enforce owner isolation, strict key allowlist, server timestamps, and immutable create/delete lifecycle', () => {
  const rules = readRules();
  assert.match(rules, /match\s+\/wishlist\/\{wishlistKey\}/);
  assert.match(rules, /isValidUserWishlistItem\(incoming\(\),\s*wishlistKey\)/);
  assert.match(rules, /data\.wishlistKey\s*==\s*wishlistKey/);
  assert.match(rules, /allow\s+update:\s*if\s+false;/);
});
