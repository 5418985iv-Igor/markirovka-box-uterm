# Security Specification: МаркировкаBox (Честный ЗНАК)

## 1. Data Invariants
1. **Operator Isolation**: Every `AssemblyBox` and `ScannedItem` is owned by an authenticated `operatorId == request.auth.uid`. An operator can only read, list, create, or update their own boxes and items.
2. **PII / Profile Isolation**: `/users/{userId}` does not allow `list` queries and restricts `get`/`create`/`update` strictly to `request.auth.uid == userId`.
3. **Master Gate & Atomicity**: A `ScannedItem` under `/boxes/{boxId}/items/{itemId}` cannot be created or deleted unless the parent `/boxes/{boxId}` exists, belongs to `request.auth.uid`, has `status == 'assembling'`, and the batch atomically increments/decrements `itemsCount` by exactly 1 (`getAfter`).
4. **Terminal State Locking**: Once a box transitions from `status == 'assembling'` to `status == 'completed'`, it becomes an immutable registry document — no further item additions, item deletions, or box updates are permitted.
5. **Temporal Integrity**: `createdAt`, `updatedAt`, `completedAt`, and `scannedAt` must strictly equal `request.time`.

## 2. The "Dirty Dozen" Attack Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Box Create**: `{ id: "b1", boxCode: "BOX-1", ... }` with `auth == null`.
2. **Identity Spoofing on Box Create**: `{ operatorId: "victim_uid", ... }` signed in as `attacker_uid`.
3. **Shortcut to Completed on Create**: `{ status: "completed", itemsCount: 5, ... }` during initial `create`.
4. **Shadow Field Injection on Box**: `{ ..., isAdmin: true }` rejected by `keys().hasOnly(...)`.
5. **Client Timestamp Forgery**: `{ createdAt: "2020-01-01T00:00:00Z" }` rejected by `== request.time`.
6. **ID Poisoning**: Document ID `boxId` longer than 128 chars or containing `$` / spaces rejected by `isValidId()`.
7. **Mutating Completed Box**: Adding `ScannedItem` or changing `itemsCount` when parent box has `status == 'completed'`.
8. **Orphaned Item Write**: Creating `/boxes/nonexistent/items/i1` rejected by parent `exists` / `getAfter` Master Gate.
9. **Out-of-Sync Count Cheat**: Creating `ScannedItem` without atomically incrementing parent `itemsCount` by 1 in the same batch rejected by `getAfter(...)`.
10. **Changing Immutable Box Number**: Updating `boxNumber` or `boxCode` on an existing box rejected by `affectedKeys().hasOnly(...)` and immutability equality checks.
11. **Oversized Raw Code DoS**: Creating `ScannedItem` with `rawCode` > 512 chars rejected by `.size() <= 512`.
12. **Blanket List Scraping**: Listing `/users` or listing `/boxes` without filtering by `operatorId == request.auth.uid` rejected by `allow list`.
