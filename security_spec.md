# Security Specification — ExamDash (`examdash-ed`)

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched is denied (`allow read, write: if false`).
2. **Read-Only Public Catalogs (`books`, `ExamPackDocument`)**:
   - Client/public reads are permitted ONLY when `resource.data.isPublished == true && resource.data.isDeleted == false`.
   - Client writes (`create`, `update`, `delete`) to `books` and `ExamPackDocument` are strictly forbidden (`if false`).
3. **Verified Identity & Path Variable Hardening**:
   - All user writes require `request.auth != null && request.auth.token.email_verified == true`.
   - Every single-document path variable (`userId`, `infoId`, `purchaseId`, `cartKey`, `bookId`, `examId`) is validated via `isValidId()` (`<= 128` chars, `^[a-zA-Z0-9_\-]+$`).
4. **Master Gate (Relational Parent Sync)**:
   - Subcollections under `/users/{userId}/*` (`private`, `purchases`, `cart`) require `request.auth.uid == userId` AND verify parent profile existence via `exists(/databases/$(database)/documents/users/$(userId))` (or atomic batch creation via `existsAfter(/databases/$(database)/documents/users/$(userId))`).
5. **PII Split-Collection Isolation**:
   - `/users/{userId}` forbids storing `email`, `phone`, or `address`.
   - `/users/{userId}/private/{infoId}` (only `infoId == 'contact'`) stores `email` and is readable/writable strictly by the verified owner (`request.auth.uid == userId`).
6. **Terminal State, Payment Proof & Immutable Entitlements (`purchases`)**:
   - `/users/{userId}/purchases/{purchaseId}` requires `status == 'completed'`, `createdAt == request.time`, `paidPrice >= 0`, `listPrice >= paidPrice`, and forbids ALL `update` and `delete` operations (`allow update, delete: if false`) so completed entitlements cannot be tampered with.
   - Paid entitlements (`paidPrice > 0`) MUST include `paymentProvider == 'razorpay'`, `razorpayOrderId` matching `^order_[a-zA-Z0-9]+$` (10–64 chars), and `razorpayPaymentId` matching `^pay_[a-zA-Z0-9]+$` (10–64 chars).
   - Free entitlements (`paidPrice == 0`) MUST have `paymentProvider == 'free'` (or omitted) and must NOT carry forged Razorpay IDs.
7. **Public Non-PII Ratings & Reviews (`/reviews/{reviewId}`)**:
   - Deterministic composite key `reviewId == collectionName + '_' + itemId + '_' + userId` enforces at most 1 review per verified learner per book/exam.
   - Public `get` and `list` are permitted ONLY when `resource.data.status == 'published'`. Zero PII (`email`, `phone`, `address`) is permitted in `/reviews/{reviewId}` (`hasOnly` allowlist).
   - `rating` must be an integer in `[1, 5]`, `comment` must be `10..2000` characters, `authorName` `1..80` characters, optional `title` `1..120` characters.
   - `verifiedPurchase == true` is permitted ONLY when `exists(/databases/$(database)/documents/users/$(request.auth.uid)/purchases/$(data.collectionName + '_' + data.itemId))` is true, preventing spoofed Verified Purchase badges.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Catalog Tampering**: Authenticated user attempts `create` or `update` on `/books/B1` -> `PERMISSION_DENIED`.
2. **Unpublished Draft Scraping**: Unauthenticated client queries `/books/draft_1` where `isPublished == false` -> `PERMISSION_DENIED`.
3. **Soft-Deleted Scraping**: Client queries `/ExamPackDocument/del_1` where `isDeleted == true` -> `PERMISSION_DENIED`.
4. **Shadow Ghost Field Injection**: Owner creates `/users/{uid}` with extra field `{ "isAdmin": true }` -> `PERMISSION_DENIED` (`hasOnly` check fails).
5. **PII Leakage in Public Profile**: User attempts to write `email` directly into `/users/{uid}` -> `PERMISSION_DENIED`.
6. **Cross-User PII Read**: User B attempts `get` on `/users/{userA}/private/contact` -> `PERMISSION_DENIED`.
7. **Unverified Email Spoof**: User with `email_verified == false` attempts to create `/users/{uid}` or `/reviews/{id}` -> `PERMISSION_DENIED`.
8. **ID Poisoning / Denial-of-Wallet**: Attacker passes a 500-character document ID or 100KB `displayName` -> `PERMISSION_DENIED`.
9. **Orphaned Subcollection Write**: Owner attempts to write `/users/{uid}/cart/books_B1` when `/users/{uid}` neither `exists()` nor `existsAfter()` -> `PERMISSION_DENIED`.
10. **Identity Spoofing in Payload**: User A writes `/users/{userA}/purchases/p1` with `userId: "userB"` -> `PERMISSION_DENIED`.
11. **Terminal Purchase Mutation**: User A attempts `update` on `/users/{userA}/purchases/p1` (`status == 'completed'`) to alter `itemId` -> `PERMISSION_DENIED`.
12. **Client-Forged Timestamp**: User A creates `/users/{userA}` with a past/future `createdAt` (`!= request.time`) -> `PERMISSION_DENIED`.
13. **Paid Purchase Without Razorpay Proof**: User A writes `/users/{userA}/purchases/p2` with `paidPrice: 499` and omits `razorpayOrderId` / `razorpayPaymentId` or sends malformed IDs -> `PERMISSION_DENIED`.
14. **Spoofed Verified Purchase Review**: User A creates `/reviews/books_B1_userA` with `verifiedPurchase: true` without owning `/users/userA/purchases/books_B1` -> `PERMISSION_DENIED`.
15. **Multi-Review Spam / Out-of-Range Rating**: User A creates `/reviews/books_B1_random2` (violating deterministic ID) or sets `rating: 6` / `email: "a@b.com"` -> `PERMISSION_DENIED`.


