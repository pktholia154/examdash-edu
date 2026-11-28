# Security Specification — ExamDash (`examdash-ed`)

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched is denied (`allow read, write: if false`).
2. **Read-Only Public Catalogs (`books`, `ExamPackDocument`, `category`)**:
   - Client/public reads on `books` and `ExamPackDocument` are permitted ONLY when `resource.data.isPublished == true && resource.data.isDeleted == false`.
   - Client/public reads on `category` are permitted ONLY when `resource.data.isDeleted == false` (with single-doc `get` hardened via `isValidCategoryId(categoryId)` allowing `<= 128` chars `^[a-zA-Z0-9_ \-]+$`).
   - Client writes (`create`, `update`, `delete`) to `books`, `ExamPackDocument`, and `category` are strictly forbidden (`if false`).
3. **Verified Identity & Path Variable Hardening**:
   - All user writes require `request.auth != null && request.auth.token.email_verified == true`.
   - Every single-document path variable (`userId`, `infoId`, `purchaseId`, `cartKey`, `bookId`, `examId`) is validated via `isValidId()` (`<= 128` chars, `^[a-zA-Z0-9_\-]+$`), and `categoryId` via `isValidCategoryId()` (`<= 128` chars, `^[a-zA-Z0-9_ \-]+$`).
4. **Master Gate (Relational Parent Sync)**:
   - Subcollections under `/users/{userId}/*` (`private`, `purchases`, `cart`) require `request.auth.uid == userId` AND verify parent profile existence via `exists(/databases/$(database)/documents/users/$(userId))` (or atomic batch creation via `existsAfter(/databases/$(database)/documents/users/$(userId))`).
5. **PII Split-Collection Isolation**:
   - `/users/{userId}` forbids storing `email`, `phone`, or `address`.
   - `/users/{userId}/private/{infoId}` (only `infoId == 'contact'`) stores `email` and is readable/writable strictly by the verified owner (`request.auth.uid == userId`).
6. **Validity-Bound Entitlements, Payment Proof & Expiry-Gated Lifecycle (`purchases`)**:
   - `/users/{userId}/purchases/{purchaseId}` requires `status == 'completed'`, `createdAt == request.time`, `paidPrice >= 0`, `listPrice >= paidPrice`, and optional validity fields (`validityMonths` restricted to `[1, 6]` for `ExamPackDocument` and `[3, 24]` for `books`, `validityLabel` 1–32 chars, and `expiresAt` strictly bounded to `> createdAt` and within the collection's validity window).
   - While active (`!isPurchaseExpired(existing())`), `update` and `delete` are strictly forbidden so active entitlements cannot be tampered with or extended.
   - Once expired (`isPurchaseExpired(existing())` — either `expiresAt <= request.time` or legacy fallback `180d` for exams / `730d` for books), the verified owner may `delete` the expired record or `update` (renew) it with a fresh `createdAt == request.time`, valid payment proof, and bounded `expiresAt` while keeping `purchaseId`, `userId`, `itemId`, `collectionName`, and `status` immutable.
   - Paid entitlements (`paidPrice > 0`) MUST include `paymentProvider == 'razorpay'`, `razorpayOrderId` matching `^order_[a-zA-Z0-9]+$` (10–64 chars), and `razorpayPaymentId` matching `^pay_[a-zA-Z0-9]+$` (10–64 chars).
   - Free entitlements (`paidPrice == 0`) MUST have `paymentProvider == 'free'` (or omitted) and must NOT carry forged Razorpay IDs.
7. **Public Non-PII Ratings & Reviews (`/reviews/{reviewId}`)**:
   - Deterministic composite key `reviewId == collectionName + '_' + itemId + '_' + userId` enforces at most 1 review per verified learner per book/exam.
   - Public `get` and `list` are permitted ONLY when `resource.data.status == 'published'`. Zero PII (`email`, `phone`, `address`) is permitted in `/reviews/{reviewId}` (`hasOnly` allowlist).
   - `rating` must be an integer in `[1, 5]`, `comment` must be `10..2000` characters, `authorName` `1..80` characters, optional `title` `1..120` characters.
   - `verifiedPurchase == true` is permitted ONLY when `exists(/databases/$(database)/documents/users/$(request.auth.uid)/purchases/$(data.collectionName + '_' + data.itemId))` is true, preventing spoofed Verified Purchase badges.
8. **Historical Exam Set Attempts, Telemetry & Feedback (`/users/{userId}/examAttempts/{attemptId}`)**:
   - Strictly owner-scoped (`request.auth.uid == userId && resource.data.userId == request.auth.uid`), requiring verified email on writes and parent `/users/{userId}` Master Gate (`exists` / `existsAfter`).
   - Enforces native Firestore `map` and `list` structures (zero JSON string blobs) with strict volumetric caps (`responses.size() <= 500`, `telemetry.size() <= 500`, `sectionBreakdown.size() <= 30`, `questionBreakdown.size() <= 500`, `reflectionNote.size() <= 2000`).
   - Scores, responses, section/question telemetry, and diagnostic `performanceInsights` are **strictly immutable** after creation; `allow update` permits ONLY the `SaveAttemptFeedback` action (`affectedKeys().hasOnly(['perceivedDifficulty', 'pacingFeedback', 'reflectionNote', 'updatedAt'])`) with `updatedAt == request.time`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Catalog Tampering**: Authenticated user attempts `create` or `update` on `/books/B1` -> `PERMISSION_DENIED`.
2. **Unpublished Draft Scraping**: Unauthenticated client queries `/books/draft_1` where `isPublished == false` -> `PERMISSION_DENIED`.
3. **Soft-Deleted Scraping**: Client queries `/ExamPackDocument/del_1` where `isDeleted == true` -> `PERMISSION_DENIED`.
4. **Shadow Ghost Field Injection**: Owner creates `/users/{uid}` with extra field `{ "isAdmin": true }` -> `PERMISSION_DENIED` (`hasOnly` check fails).
5. **PII Leakage in Public Profile**: User attempts to write `email` directly into `/users/{uid}` -> `PERMISSION_DENIED`.
6. **Cross-User PII Read**: User B attempts `get` on `/users/{userA}/private/contact` -> `PERMISSION_DENIED`.
7. **Unverified Email Spoof**: User with `email_verified == false` attempts to create `/users/{uid}`, `/reviews/{id}`, or `/users/{uid}/examAttempts/{attemptId}` -> `PERMISSION_DENIED`.
8. **ID Poisoning / Denial-of-Wallet**: Attacker passes a 500-character document ID or 100KB `displayName` -> `PERMISSION_DENIED`.
9. **Orphaned Subcollection Write**: Owner attempts to write `/users/{uid}/cart/books_B1` or `/users/{uid}/examAttempts/a1` when `/users/{uid}` neither `exists()` nor `existsAfter()` -> `PERMISSION_DENIED`.
10. **Identity Spoofing in Payload**: User A writes `/users/{userA}/purchases/p1` with `userId: "userB"` -> `PERMISSION_DENIED`.
11. **Active Purchase Mutation / Forged Expiry**: User A attempts `update` or `delete` on an active `/users/{userA}/purchases/p1`, or writes a 1-month exam purchase with `expiresAt` set 5 years ahead -> `PERMISSION_DENIED`.
12. **Client-Forged Timestamp**: User A creates `/users/{userA}` with a past/future `createdAt` (`!= request.time`) -> `PERMISSION_DENIED`.
13. **Paid Purchase Without Razorpay Proof**: User A writes `/users/{userA}/purchases/p2` with `paidPrice: 499` and omits `razorpayOrderId` / `razorpayPaymentId` or sends malformed IDs -> `PERMISSION_DENIED`.
14. **Spoofed Verified Purchase Review**: User A creates `/reviews/books_B1_userA` with `verifiedPurchase: true` without owning `/users/userA/purchases/books_B1` -> `PERMISSION_DENIED`.
15. **Multi-Review Spam / Out-of-Range Rating**: User A creates `/reviews/books_B1_random2` (violating deterministic ID) or sets `rating: 6` / `email: "a@b.com"` -> `PERMISSION_DENIED`.
16. **Historical Score Tampering on Update**: User A attempts `update` on `/users/{userA}/examAttempts/att_1` to inflate `totalScore` or alter `responses` -> `PERMISSION_DENIED` (`SaveAttemptFeedback` `affectedKeys().hasOnly(...)` & score immutability gates reject).
17. **Cross-User Attempt Telemetry Scraping**: User B attempts `list` or `get` on `/users/{userA}/examAttempts` -> `PERMISSION_DENIED` (`request.auth.uid == userId && resource.data.userId == request.auth.uid`).
18. **Unbounded Array / Map Resource Exhaustion in Exam Attempt**: Attacker submits `questionBreakdown` with 2,000 items or `reflectionNote` of 50KB -> `PERMISSION_DENIED`.
19. **Invalid Validity Tier Injection**: User A submits `validityMonths: 12` for an exam pack or `validityMonths: 99` for a book -> `PERMISSION_DENIED`.
