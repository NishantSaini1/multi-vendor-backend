# Multi-Vendor Backend

Node.js + TypeScript + Express + MongoDB + Redis backend for a multi-location
Food + Instamart + Delivery marketplace.

## Stack

Express, Mongoose (MongoDB), ioredis (Redis), JWT, bcryptjs, Zod, Cloudinary,
multer, Razorpay, OneSignal (push notifications, via REST — no server SDK
needed), axios (Nominatim geocoding), Nodemailer, Pino, Helmet,
express-rate-limit.

## Getting started

```bash
npm install
cp .env.example .env   # fill in MONGO_URI, JWT_SECRET, JWT_REFRESH_SECRET at minimum
npm run dev             # starts on http://localhost:5000
```

Requires a running MongoDB and Redis instance (see `MONGO_URI` / `REDIS_URL`
in `.env`). **MongoDB must be a replica set** (even a single-node one) for the
Inventory/Order transactional flows to work — a plain standalone `mongod`
does not support multi-document transactions. Any managed cluster (Atlas,
etc.) already satisfies this; for local development, initialize a one-node
replica set (`mongod --replSet rs0` then `rs.initiate()` in `mongosh`) rather
than running plain `mongod`.

```bash
npm run build   # compile to dist/
npm start       # run compiled server
npm run seed     # populate dev data (2 locations, admins, vendors, stores, customers, delivery partners)
npm test         # run unit tests
```

Seeded accounts (see `npm run seed` output for the exact password, default
`ChangeMe123` unless `SEED_DEFAULT_PASSWORD` is set):

- Admin: `superadmin@example.com` (SUPER_ADMIN), plus one admin per role
- Vendors / Stores / Delivery Partners: seeded with phone-based logins, see
  `src/utils/seed.ts` for the generated phone numbers

## Architecture

```
Route -> Controller -> Service -> Repository (where needed) -> Model -> MongoDB
```

All business logic lives in `src/services`. Controllers stay thin (parse
request, call service, format response). Every operational model carries a
`locationId` — see "Location-first design" below.

## API

Base path: `/api/v1`. Swagger UI: `/api-docs`. Health checks: `/api/v1/health`,
`/api/v1/health/database`, `/api/v1/health/redis`.

## What's implemented (foundation phase)

- Project scaffold, TypeScript strict config, env validation (Zod)
- MongoDB (Mongoose) + Redis connections, structured logging (Pino, secrets
  redacted), Swagger/OpenAPI wiring
- Security middleware: Helmet, CORS (env-driven allowlist), mongo-sanitize,
  hpp, Redis-backed rate limiting (general + OTP send/verify + login)
- All ~46 Mongoose models from the spec (`src/models`)
- Full authentication for all four user types:
  - Customer: phone + OTP (Redis-backed, hashed, cooldown, max attempts,
    dev-only OTP echo), change-phone, sessions list/revoke, logout-all
  - Vendor: phone/email + password, forgot/reset/change password, logout-all
  - Delivery Partner: phone + password, same password-lifecycle endpoints
  - Admin: email + password, same password-lifecycle endpoints
  - Shared: JWT access + rotating refresh tokens persisted in `RefreshToken`
    (rotation + revocation), RBAC (`requirePermission`) and location-based
    authorization (`requireLocationAccess`) middleware
- Location module: full CRUD, status, settings, dashboard (counts), all
  location-scoped for admin RBAC
- Delivery zones: full CRUD + status, radius- or polygon-based
  (`$geoIntersects` when a polygon is set, nearest-match by haversine distance
  otherwise), location-scoped
- Serviceability check (`POST /serviceability/check`, public): resolves the
  serving `Location` by haversine distance within its `serviceRadius`, then
  the matching `DeliveryZone`, then confirms an active vendor/store actually
  exists there for the requested `businessType` before reporting serviceable
- Vendors: full admin CRUD, approve/reject/suspend/activate, dashboard
  (product counts), products listing, vendor documents CRUD — all
  location-scoped (post-fetch `assertLocationAccess`, since the entity's
  `locationId` isn't known until it's loaded)
- Food catalog:
  - Categories/subcategories: admin-only taxonomy. A category with
    `locationId: null` is global (SUPER_ADMIN-only to create/edit); a
    location-scoped category follows normal `assertLocationAccess`.
    Subcategories validate `categoryId` exists and inherit their parent
    category's access rules
  - Products, variants, addons: **vendor-owned, dual-actor** — both the
    owning `VENDOR` JWT (self-scoped, `vendorId`/`locationId` always
    server-derived from the authenticated vendor, never trusted from the
    request body) and a location-scoped `ADMIN` can manage the same
    `/food/products`, `/food/products/:id/variants`, `/food/addons` routes.
    Per spec section 79 ("API-first... do not create business logic
    separately for each frontend"), this is the same REST surface serving
    both the Vendor App and the Admin Panel — see
    `assertOwnerOrLocationAccess` in `rbac.middleware.ts`. Product creation
    validates `subcategory.categoryId === categoryId` and (for an admin
    actor) `vendor.locationId === locationId`; addon `productIds` must all
    belong to the same vendor
- Stores: full admin CRUD, dashboard (product/low-stock/out-of-stock counts),
  products listing, inventory listing, store documents CRUD — **admin-only**
  (Store has no login of its own; see `src/models/Store.ts`), unlike the
  vendor/admin dual-actor pattern used for the Food catalog
- Instamart catalog:
  - Categories/subcategories: admin-only taxonomy, same global/location-scoped
    rules as the Food catalog
  - Products: admin-only CRUD, validated against the owning store's location
    and category/subcategory consistency. Creating a product transactionally
    also creates its zero-stock `Inventory` record in the same store;
    deleting a product transactionally removes that record too
- Inventory: `GET /inventory`, `/inventory/:id`, `/inventory/product/:id`,
  `/inventory/low-stock`, `/inventory/out-of-stock`, `/inventory/:id/history`,
  `POST /inventory/adjust` (single transaction type: PURCHASE/SALE/RETURN/
  DAMAGE/ADJUSTMENT/RESERVATION/RELEASE), `POST /inventory/bulk-update`
  (absolute stock sets). Every stock change runs inside a MongoDB
  multi-document transaction (`mongoose.startSession()` +
  `session.withTransaction()`) that updates the `Inventory` doc and writes
  an `InventoryTransaction` audit row atomically; RESERVATION/SALE/DAMAGE
  reject when there isn't enough available stock. **This requires MongoDB to
  be running as a replica set** (even a single-node one — this is MongoDB's
  own standard recommendation and true of every managed Atlas cluster by
  default) — a plain standalone `mongod` does not support transactions.
  The test suite's `mongodb-memory-server` harness was upgraded from
  `MongoMemoryServer` to `MongoMemoryReplSet` (single node) specifically so
  these transactional paths are exercised for real, not just type-checked
- Customers: admin CRUD (view/update profile fields, block/unblock, delete),
  dashboard (order/address counts, wallet balance) — customers don't carry a
  `locationId` (they can order from anywhere), so this module has no
  location-based RBAC scoping, only the ordinary `CUSTOMER_VIEW`/`_UPDATE`/
  `_DELETE` permissions
- Customer addresses (`/customers/:customerId/addresses/*`): **customer-owned,
  dual-actor** — the owning `CUSTOMER` JWT (self-scoped: `customerId` in the
  URL must match the token) manages their own addresses via the customer app;
  an `ADMIN` with `CUSTOMER_UPDATE` can also manage them for support. First
  address for a customer is always forced default; setting a new default
  unsets the previous one; deleting the current default promotes the
  next-oldest address to default automatically
- Delivery partners: admin CRUD/approval (approve/reject/suspend/activate),
  documents CRUD — all **admin-only**, plus a **dual-actor** subset (the
  owning `DELIVERY_PARTNER` JWT, self-scoped, or a location-scoped `ADMIN`):
  `GET /:id`, `PATCH /:id/availability`, `POST`/`GET /:id/location`,
  `GET`/`PUT /:id/vehicle`. Unlike the Food catalog's dual-actor routes
  (mounted under one shared `authenticate('ADMIN','VENDOR')`), this resource
  mixes admin-only and dual-actor actions on the *same* base path, so each
  route in `deliveryPartner.routes.ts` picks its own `authenticate(...)` call
  rather than one blanket router-level middleware — mixing actor types at the
  router level here would have let a partner hit the admin-only endpoints
  since `requirePermission` is a no-op for non-admin actors
- Delivery partner location tracking: live position is written to both the
  `DeliveryPartner` document (`currentLatitude`/`currentLongitude`) and a
  Redis GEO set per location (`location:<locationId>:active-partners`, per
  spec section 68's key pattern) — the Redis entry is added only while the
  partner is `ONLINE` and removed the instant they go anything else
  (`OFFLINE`/`BUSY`/`ON_DELIVERY`) or are deactivated by an admin, so the set
  always reflects genuinely assignable partners
- `GET /delivery/available-partners` (admin, `DELIVERY_ASSIGN` permission):
  Redis `GEOSEARCH` for `ONLINE`+`ACTIVE` partners near a pickup point,
  ranked by distance — this is the read-only "who could take this" query
  from spec section 33. **`POST /delivery/assign` and `/reassign` are
  deliberately not built yet** — assigning a partner requires a real
  `Delivery` record attached to an `orderId`, which doesn't exist until the
  Order module is built (next on the roadmap); building them now would mean
  either faking the Order dependency or shipping something broken
- Orders (`/orders`) — the unified Food/Instamart order model:
  - `POST /orders` (customer-only) runs the full spec section 38 validation
    chain: customer → address → location (active) → serviceability →
    vendor/store (active, same location as the address, vendor also `isOpen`)
    → each item (belongs to that vendor/store, active/available, variant
    belongs to the product, addon belongs to the vendor) → for Instamart,
    stock. **All money is computed server-side** — the create-order request
    body carries no price/discount/tax/fee/total fields at all, so there is
    nothing for a client to spoof. Line math (documented judgment call, the
    spec doesn't pin down the exact formula — see `computeLine` in
    `order.service.ts`): `discount`/`tax` on a product are percentages;
    discount applies to the pre-tax line (incl. addons for Food), tax
    applies after the discount; delivery fee comes from the resolved
    `DeliveryZone`, waived once the subtotal clears its `freeDeliveryAbove`;
    packaging/platform fees default to 0 (no config source exists for them
    yet). Commission is deliberately **not** computed or stored at order
    time — it's a settlement-time concern once that module exists, not an
    order-time one
  - Instamart orders reserve stock **transactionally with order creation**
    (`mongoose.startSession()` + `withTransaction()`, matching the Inventory
    module's pattern) — the authoritative stock check happens inside the
    transaction (a pre-check outside it just fails fast for the common
    case); cancellation transactionally releases that same reservation
  - Status machine reuses the `FOOD_ORDER_TRANSITIONS`/
    `INSTAMART_ORDER_TRANSITIONS` maps from `constants/orderStatus.ts`
    (defined back in the Phase 1 scaffold) as the actual safety net — any of
    ADMIN/the order's own VENDOR/the order's own assigned DELIVERY_PARTNER
    can call `PATCH /:id/status` with any next status the map allows, rather
    than hand-coding a separate "who can set which status" permission
    matrix; the map already prevents invalid jumps (e.g. `PENDING` straight
    to `DELIVERED`). Cancellation (`POST /:id/cancel`, customer/vendor/admin)
    is allowed from any pre-pickup status (`PENDING`/`CONFIRMED`/
    `PREPARING`/`PACKING`) per the same map, not once `READY_FOR_PICKUP`
  - Ownership/authorization (`assertOrderAccess` in `order.service.ts`):
    CUSTOMER → own orders only, VENDOR → own orders only, DELIVERY_PARTNER →
    only orders assigned to them, ADMIN → location-scoped. List endpoints
    apply the same scoping as a query filter rather than 403ing
  - `PATCH /orders/:id` (admin-only) is deliberately narrow — it only allows
    amending `deliveryAddress` fields (a real support scenario: "customer
    gave the wrong flat number") — nothing money/item/party-related is
    editable after creation, by design
- Seed script for locations/admins/vendors/stores/customers/delivery
  partners/basic food & instamart catalog
- RBAC permission model: `LOCATION_ADMIN` has full operational control
  (create/update/approve vendors & stores, manage delivery zones, manage the
  food catalog, etc.) within their assigned location(s); role-scoped admins
  (`FOOD_ADMIN`, `DELIVERY_ADMIN`, ...) are domain-scoped across every
  location. An admin's `locationIds` only restricts them when non-empty —
  see `src/middleware/rbac.middleware.ts` for the full semantics
  (`hasLocationAccess` / `assertLocationAccess` / `locationScopeFilter` /
  `assertOwnerOrLocationAccess`). `requirePermission` is a no-op for
  non-ADMIN actors (e.g. a VENDOR JWT), since RBAC permissions only apply to
  admins — vendor/store-owned routes rely on ownership checks instead

## Location-first design

Every operational entity (`Vendor`, `Store`, `FoodProduct`,
`InstamartProduct`, `Inventory`, `Order`, `DeliveryPartner`, `DeliveryZone`)
carries a `locationId`. Adding a new town is a `POST /locations` call plus
whatever catalog/vendor data you attach to it — no code changes, and no town
names are hardcoded in business logic (only in `seed.ts`, which is
illustrative dev fixture data).

## Module build order (complete)

All 17 steps below are done — every route group is wired into
`src/routes/index.ts`, each following the same Route → Controller → Service
→ Model layering and reusing the auth/RBAC/location-authorization
middleware built in step 1. Kept here as the build history / design-log for
the judgment calls made along the way (the spec doesn't pin down every
detail — money math, commission splits, notification wiring, what's public
vs. authenticated, etc. — and the reasoning for each is recorded inline
below rather than lost once the code shipped):

1. ~~Delivery zones + serviceability check~~ — done
2. ~~Vendors (admin CRUD/approval) + Food catalog (categories, subcategories,
   products, variants, addons)~~ — done
3. ~~Stores (admin CRUD) + Instamart catalog + Inventory (with Mongo
   transactions for reserve/release)~~ — done. (The `Store` model's unused
   `password` field from the Phase 1 scaffold was removed — Store has no
   login of its own per the spec.)
4. ~~Customers + Customer addresses~~ — done
5. ~~Delivery partners (admin CRUD/approval) + partner location tracking~~ —
   done, including the Redis-geo `GET /delivery/available-partners`
   discovery query. `POST /delivery/assign` and `/reassign` deliberately
   deferred to step 7 below, once real orders exist to assign a partner to.
6. ~~Orders (unified Food/Instamart model, server-side price calculation,
   status machine, cancellation) + OrderItem + OrderStatusHistory~~ — done
7. ~~Delivery + DeliveryStatusHistory + tracking + the deferred
   `POST /delivery/assign` and `/delivery/reassign` from step 5~~ — done
8. ~~Payments (Razorpay) + webhook verification + Refunds + Wallet~~ — done.
   `POST /payments/razorpay-order` + `/verify` handle client-side checkout;
   `POST /payments/webhook` is the authoritative fallback (HMAC-verified
   against the raw request body, independent of `/verify` — a dropped network
   response after Razorpay already captured the payment must not leave an
   order stuck PENDING). WALLET is settled synchronously inside the same
   transaction as order creation (see `order.service.createOrder`) since
   there's no external checkout step to wait on; RAZORPAY and COD stay
   PENDING until checkout completes / delivery collection (COD collection
   itself isn't built yet — no endpoint marks a COD order paid). Refunds
   route to whatever the customer actually paid with (Razorpay gateway
   refund vs. a Wallet credit), and cancelling an already-PAID order
   auto-refunds it (best-effort, outside the cancellation's DB transaction
   since it's an external call for RAZORPAY) rather than leaving the money
   stranded. Wallet is mounted per-customer at
   `/customers/:customerId/wallet` rather than as its own top-level group.
9. ~~Commission + Settlements (vendor/store/delivery)~~ — done. Commission
   rules (`/commissions`) are admin-managed at GLOBAL/LOCATION/VENDOR/STORE
   levels — GLOBAL is SUPER_ADMIN-only, the others inherit their location
   from the locationId/vendor/store they scope to. `POST /settlements/generate`
   groups DELIVERED orders in a date range by payee and computes
   grossAmount/commissionAmount/netAmount per payee, resolving the most
   specific applicable Commission rule (STORE/VENDOR > LOCATION > GLOBAL);
   regenerating over an already-settled, overlapping period for a payee is
   skipped rather than double-counted. Two documented judgment calls (spec
   doesn't pin either down): a vendor/store's gross settlement amount is item
   revenue only (subtotal - discount, not delivery fee/tax/platform fee —
   those aren't the vendor's money), and delivery partners keep 100% of their
   delivery fees under this scaffold (COMMISSION_LEVELS has no
   DELIVERY_PARTNER level — a platform cut on deliveries, if ever needed, is
   a separate future decision). Settlements then move PENDING →
   (`/adjustments` editable only here) → PROCESSING (`/process`) → PAID
   (`/pay`, requires a transactionReference). Reads are dual-actor (a
   VENDOR/DELIVERY_PARTNER sees only their own settlements; Store has no
   login, so STORE settlements are admin-view-only); every write is
   admin-only (SETTLEMENT_PROCESS/SETTLEMENT_PAY, already scaffolded back in
   Phase 1).
10. ~~Coupons, Offers, Banners~~ — done. Coupon eligibility/discount
    validation happens as part of `POST /orders` itself (an optional
    `couponCode` field), inside the same transaction as order creation —
    never a separate "preview" endpoint, so the money math only ever lives
    in one place (`order.service.createOrder`, which calls
    `coupon.service.applyCoupon`). Per-user usage is derived by counting the
    customer's non-CANCELLED Orders carrying that `couponCode` rather than a
    separate usage-tracking collection; a cancelled order frees up that
    customer's per-user limit again, but the coupon's own global
    `usedCount` counter is *not* decremented on cancellation (a documented
    asymmetry — a hard global cap that ignores cancellations is the more
    common real-world promo-code policy, guarding against
    place-cancel-reorder abuse). Offers and Banners are deliberately
    display-only/informational content (`GET /offers/active`,
    `GET /banners/active` — public, unauthenticated, scoped by
    location/vendor/store/placement) with no order-pricing effect of their
    own; modeling an actual checkout discount as an Offer would mean two
    discount systems that could disagree, so anything that needs to touch a
    total is a Coupon instead.
11. ~~Reviews~~ — done. A review can only be created for a DELIVERED order,
    and its target (`targetType`/`targetId`) must actually have been part of
    that order (the order's own `vendorId`/`storeId`/`deliveryPartnerId`, or
    — for `PRODUCT` — one of its OrderItems); a compound unique index on
    (orderId, targetType, targetId) backstops one review per target per
    order. Creating/editing/deleting/hiding a review transactionally
    recomputes the target's aggregate `rating`/`ratingCount` — but only for
    VENDOR/STORE/DELIVERY_PARTNER, the three models that carry those fields;
    PRODUCT reviews are valid but have no aggregate to write into in this
    scaffold. Browsing (`GET /reviews`, `GET /reviews/:id`) is public and
    shows only VISIBLE reviews to anonymous callers, using a new
    `authenticateOptional` middleware (attaches `req.user` when a valid
    token is present, never rejects) so a logged-in review author can still
    see their own HIDDEN review and an admin with `REVIEW_VIEW` sees
    everything — without duplicating the route. Editing/deleting is
    author-only; hiding (moderation) is `REVIEW_MODERATE`-gated and granted
    to SUPPORT_ADMIN, matching that role's existing customer-facing/support
    permission set.
12. ~~Notifications (OneSignal) + device registration~~ — done, using
    **OneSignal** rather than the Firebase/FCM scaffolding originally left
    from Phase 1 (per explicit direction mid-build) — `firebase-admin` and
    `src/config/firebase.ts` were removed, and `NotificationDevice`'s device
    token field is `playerId` (OneSignal's own per-device subscription id,
    obtained client-side by their SDK), not an `fcmToken`. `notify()` in
    notification.service is the single send primitive every other module
    calls: it always writes the in-app `Notification` record first (the
    durable source of truth, must succeed even if OneSignal is unreachable
    or unconfigured — `config/onesignal.ts` degrades to a no-op the same way
    `config/razorpay.ts` does), then best-effort pushes to every device the
    user has registered; it never throws, since it's called as a
    fire-and-forget side effect after the triggering operation's own work
    (and DB transaction, where relevant) has already completed. Wired into
    real events rather than left as an unused primitive: order creation
    (`ORDER_CREATED`, plus `PAYMENT_SUCCESS` for WALLET's synchronous payment),
    every vendor- and delivery-driven order status transition (`ORDER_
    CONFIRMED`/`PREPARING`/`READY`/`PARTNER_ASSIGNED`/`PICKED_UP`/`OUT_FOR_
    DELIVERY`/`DELIVERED`/`CANCELLED` — a shared mapping in `utils/
    orderNotifications.ts` used by both order.service and delivery.service,
    since a given order status has exactly one customer-facing meaning
    regardless of which service actually drove that transition), Razorpay
    payment confirmation (`PAYMENT_SUCCESS`), refund completion
    (`REFUND_COMPLETED`), and a paid-out settlement (`SETTLEMENT_COMPLETED`,
    sent to the VENDOR/DELIVERY_PARTNER payee — Store has no login, so no
    STORE settlement ever notifies anyone). `GET /notifications` and its
    read/unread endpoints are self-scoped for any authenticated actor type,
    not role-specific.
13. ~~Delivery issues~~ — done. Only the three parties who actually
    experience a delivery (the order's customer/vendor, or the delivery's
    own assigned partner) can raise an issue against it — deliberately no
    admin-on-behalf-of path. Reads are symmetric: any of those same three
    parties can see an issue raised on their delivery, not just the ones
    they personally raised (a delivery partner needs visibility into a
    complaint the customer filed, and vice versa), plus an admin with
    `DELIVERY_ISSUE_VIEW`, location-scoped via the owning Order (the model
    has no locationId of its own). Resolving/closing (`DELIVERY_ISSUE_
    MANAGE`, granted to DELIVERY_ADMIN and SUPPORT_ADMIN) requires a
    `resolutionNote` — an ops/support ticket needs an explanation, not just
    a status flip.
14. ~~Admin users/roles/permissions management + Activity logs~~ — done.
    `/admin-users` CRUD (+ status/reset-password) is SUPER_ADMIN-exclusive,
    matching how ADMIN_USER_*/ACTIVITY_LOG_VIEW were already granted only to
    SUPER_ADMIN back in Phase 1. Two safety rules an admin-provisioning
    endpoint needs that nothing else in this codebase does: you can never
    modify your own account's status or delete yourself
    (`CANNOT_MODIFY_SELF`), and the last active SUPER_ADMIN can never be
    blocked or deleted (`LAST_SUPER_ADMIN`) — otherwise a single mistake
    locks everyone out permanently. Blocking/deleting/resetting an admin's
    password all revoke their existing sessions via the same
    `revokeAllTokensForUser` helper `changeAdminPassword` already used.
    "Roles/permissions management" is deliberately a **read-only reference**
    (`GET /admin-users/roles`, `GET /admin-users/permissions`) rather than a
    dynamic RBAC editor — this codebase's permission model
    (`ROLE_DEFAULT_PERMISSIONS`) has been a static, code-defined map since
    Phase 1, and turning it into a runtime-editable one would be a much
    larger architectural change than "add an endpoint." Activity logs
    (`GET /activity-logs`, read-only) are written by a new fire-and-forget
    `activityLog.service.logActivity()` (never throws, same resilience
    shape as `notification.service.notify()`) — instrumented for real on
    this phase's own admin-user mutations (create/update/status/delete/
    password-reset) rather than retrofitted across every existing admin
    endpoint in the whole codebase; broader coverage is a natural, separate
    follow-up, not something this pass claims to have finished.
15. ~~Dashboard aggregation APIs, Search, Uploads (Cloudinary), Geocoding
    (Nominatim)~~ — done, four independent utility modules bundled under one
    roadmap step. **Dashboard** (`GET /dashboard/overview`,
    `/orders-trend`) is admin-only, location-scoped, and new permission
    `DASHBOARD_VIEW` (granted to LOCATION_ADMIN); reused
    `deliveryIssue.service.deliveryIssueListFilter` rather than duplicating
    its Order-location join for the open-issues count. **Search**
    (`GET /search`, public, no auth — same tier as `/offers/active` and
    `/banners/active`) uses MongoDB `$text` search; FoodProduct/
    InstamartProduct already had text indexes scaffolded back in Phase 1
    anticipating exactly this, so Vendor/Store gained matching ones now
    rather than mixing `$text` and regex across the four collections.
    **Uploads** (`POST/DELETE /uploads`, Cloudinary) added `multer` —
    deliberately the 2.x line, not 1.x (which `npm install` warns is
    unpatched for several known vulnerabilities) — using memory storage so
    a file's bytes only ever exist as a buffer streamed straight to
    Cloudinary, never touching local disk; stateless by design (no
    "Upload" ownership model — see README trade-off note in the route file)
    with a new `MulterError` branch in the global error handler for a
    friendly "file too large" response instead of a raw 500. **Geocoding**
    (`GET /geocoding/search`, `/reverse`) proxies OpenStreetMap Nominatim —
    authenticated (any actor) rather than public, since this fronts a
    third-party service with its own usage policy and an open unauthenticated
    proxy would risk violating it; `config/nominatim.ts` exports the
    configured axios client as a stable, spy-able object (mirroring
    `config/razorpay.ts`) specifically so tests can mock it without hitting
    the real network. All four fail closed with clear error codes when
    unconfigured/unreachable (`UPLOAD_NOT_CONFIGURED`,
    `GEOCODING_UNAVAILABLE`) rather than crashing or silently no-op'ing —
    unlike notifications, these are the actual requested operation, not a
    fire-and-forget side effect, so the caller needs to know it failed.
16. ~~Background jobs (order timeout, settlement processing, notification
    retry)~~ — done. Uses `node-cron` (an in-process scheduler, no
    Redis-backed queue infra) — these are periodic sweeps, not one-off async
    task dispatch, so the added complexity of a real job queue wasn't
    justified. Each job's logic is its own exported, directly-callable,
    directly-testable function (`jobs/orderTimeout.job.ts`, `settlement
    Generation.job.ts`, `notificationRetry.job.ts`); `jobs/index.ts` is thin
    glue wiring them to cron schedules, wrapped so one job throwing never
    kills the process or blocks the others. All three reuse existing
    service functions as-is rather than duplicating logic: the order-
    timeout sweep just finds which orders qualify and drives them through
    the *same* `order.service.cancelOrder` a customer would hit (inventory
    release, auto-refund, notification — all already there); daily
    settlement generation calls `settlement.service.generateSettlements`
    once per payee type with no locationId filter (safe to re-run daily —
    an already-settled, overlapping period is skipped, not double-counted).
    Both need a real JwtPayload to call into admin-gated service functions
    from an unattended job — new `utils/systemActor.ts` provides a fixed,
    well-known `SUPER_ADMIN` pseudo-actor (not a real AdminUser row) whose
    empty `locationIds` + SUPER_ADMIN role trivially clears every
    location-scoping check. Notification retry needed real new
    infrastructure, not just a reusable service call: `Notification` gained
    `pushStatus`/`pushAttempts` fields, and `config/onesignal.ts`'s
    `sendPush` now returns a `'sent'|'skipped'|'failed'` result instead of
    void, so `notify()` can record what actually happened and the retry job
    knows which rows are worth re-attempting (bounded by both an attempt
    cap and an age cutoff, so a permanently-unreachable OneSignal or a user
    who never registers a working device doesn't retry forever).
17. ~~Integration/E2E test suite covering cross-location and cross-vendor
    authorization, OTP brute force, expired/invalid tokens, insufficient
    inventory, and invalid order totals~~ — done
    (`tests/integration/e2e.test.ts`). Cross-vendor 403s, insufficient-
    inventory rejection, and "the client can't influence its own order
    total" were already exercised incidentally inside several module test
    files (order.test.ts, storeInstamartInventory.test.ts,
    foodCatalog.test.ts) — this suite deliberately does not re-litigate
    those, and instead covers what nothing else did: OTP brute force
    (`OTP_MAX_ATTEMPTS` lockout, and confirms the *genuinely correct* OTP is
    rejected afterward too, since the record is purged on lockout — not
    just that further guesses fail); malformed/wrong-secret-forged/
    genuinely-expired JWTs across actor types (all collapse to the same
    `TOKEN_INVALID` — auth.middleware's catch-all doesn't distinguish
    "expired" from "invalid", by design); and cross-location data leakage
    through **list** endpoints specifically (`GET /vendors`, `GET /orders`
    as a location-scoped LOCATION_ADMIN never includes another location's
    rows) — a materially different attack surface than the single-resource
    403s locationAuthorization.test.ts already checked back in Phase 1.

## Security notes

- Passwords: bcrypt, 12 salt rounds, never returned in responses
  (`select: false` on the schema field)
- OTPs: 6 digits, hashed (SHA-256 + secret) before storing in Redis, 5-minute
  expiry, 60s resend cooldown, max attempt count, invalidated after use,
  never logged or returned outside development
- JWTs carry only `userId`, `userType`, `role`, `locationIds` — never
  passwords, OTPs, or other sensitive data
- Refresh tokens are rotated on every use and can be revoked individually or
  all-at-once per user
- Logger redacts `password`, `otp`, `jwt`, `refreshToken`, `token` fields
