# E-Commerce Platform — Backend Implementation Document

**Stack:** Node.js + Express + TypeScript 7 (backend) · React (frontend) · PostgreSQL + Sequelize (models + CLI migrations) · Redis · BullMQ · AWS S3 · Razorpay

---

## 1. System Overview

A multi-vendor e-commerce platform supporting:
- Customers browsing/purchasing across multiple vendors in a single checkout
- Vendors independently managing their own catalog, inventory, and orders
- Admins overseeing the entire platform, approving vendors/products, and managing commissions/payouts
- An advanced, rule-driven coupon engine supporting complex discount logic

### 1.1 High-Level Architecture

```
Client (React)
      │
      ▼
API Gateway / Express App
      │
   ┌──┴───────────────────────────────────────┐
   │                                            │
Auth/RBAC Middleware                    Rate Limiter / Validation
   │                                            │
   ▼                                            ▼
Route Layer  →  Controller Layer  →  Service Layer  →  Repository/Sequelize Layer
                                            │
                     ┌──────────────────────┼───────────────────────┐
                     ▼                      ▼                       ▼
                PostgreSQL              Redis (cache/         BullMQ (async
                (source of truth)       sessions/cart)         jobs: email,
                                                                 payout, etc.)
```

**Design principle:** Controllers stay thin (parse request → call service → return response). All business logic (coupon validation, order splitting, commission calc) lives in the service layer so it's unit-testable independent of HTTP.

---

## 2. Tech Stack Decisions

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js + Express | As specified |
| Language | TypeScript 7.x (native Go-based compiler, `tsc`/`tsgo`) | Static typing across the whole stack; TS 7 ships an ~8–12x faster compiler/language-service than TS 6, so type-checking a large codebase stays fast in dev and CI |
| Database | PostgreSQL | Relational integrity critical for orders, inventory, payouts |
| ORM | Sequelize (+ sequelize-cli migrations, typed via `InferAttributes`/`InferCreationAttributes`) | Mature migration tooling, explicit schema versioning, full type-safety without decorators |
| Cache/Session | Redis | Cart persistence, rate limiting, coupon usage counters |
| Queue | BullMQ (Redis-backed) | Emails, payout batch jobs, abandoned cart reminders |
| Auth | JWT (access + refresh) + bcrypt | Stateless, scalable |
| File Storage | AWS S3 | Product images, vendor KYC documents |
| Payments | Razorpay (Orders + Route for vendor payouts) | Webhook-driven confirmation, supports split payouts to vendors |
| Validation | Zod | Schema validation at route boundary; `z.infer<>` derives TS types from schemas so validation and types never drift apart |
| Search | PostgreSQL full-text search only (`tsvector` + GIN + `pg_trgm`) | No external search service — see dedicated section 7 for indexing/optimization strategy |
| Email | AWS S3 stack pairs naturally with AWS SES; queued via BullMQ, never sent synchronously | See Section 8 for the full trigger matrix and worker design |

> **Note on "the Rust one":** the new fast TypeScript compiler (TS 7, codename Project Corsa) is actually a **Go** rewrite, not Rust — Microsoft evaluated Rust but chose Go for closer parity with the existing compiler's memory/traversal patterns. It ships as the standard `tsc`/`tsgo` binary once you install `typescript@latest` (TS 7 is GA), giving roughly 8–12x faster type-checking with no config rewrite needed. Section 2.1 below has the concrete setup.

### 2.1 TypeScript Setup

**Install (TS 7, native compiler included automatically):**

```bash
npm install --save-dev typescript@latest ts-node-dev @types/node @types/express
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier
```

`typescript@latest` now resolves to TS 7, which ships the Go-native compiler as the default `tsc` binary — no separate `tsgo` install needed for day-to-day use. If you want to trial nightlies ahead of a stable bump, `@typescript/native-preview` is the separate preview package, but for this project pin to the stable `typescript` release.

**`tsconfig.json`:**

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": "./src",
    "paths": {
      "@config/*": ["config/*"],
      "@middleware/*": ["middleware/*"],
      "@modules/*": ["modules/*"],
      "@jobs/*": ["jobs/*"],
      "@utils/*": ["utils/*"],
      "@core/*": ["core/*"],
      "@database/*": ["../database/*"]
    },

    // Strictness — non-negotiable for a codebase this size
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true,

    // Module interop
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,

    // Emit
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "removeComments": false,
    "incremental": true,
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts", "database/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests/**/*.spec.ts"]
}
```

> **TS 7 breaking-change note:** TS 7 hard-adopts several TS 6.0 strict defaults — `rootDir` defaults to `./` if unset, `types` defaults to an empty array (so ambient `@types/*` packages must be explicitly listed if you rely on them), and `target: es5` / `moduleResolution: node` / `baseUrl`-without-`paths` are no longer accepted. The config above already sets these explicitly so you won't hit them.

**`package.json` scripts:**

```json
{
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only -r tsconfig-paths/register src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node -r tsconfig-paths/register dist/server.js",
    "lint": "eslint . --ext .ts",
    "typecheck": "tsc --noEmit",
    "db:migrate": "sequelize-cli db:migrate",
    "db:seed": "sequelize-cli db:seed:all",
    "test": "jest"
  }
}
```

Run `npm run typecheck` in CI as a separate fast step (this is exactly the job TS 7's speedup benefits most — full-project type inference with no emit).

**Path aliases at runtime:** since `tsc` doesn't rewrite `@modules/*` imports, install `tsconfig-paths` and register it in both `dev` and `start` scripts (shown above) so aliases resolve identically in dev and production.

**Typed Sequelize models (no decorators, migrations stay CLI-driven):**

```ts
// database/models/user.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare passwordHash: string;
  declare name: string;
  declare phone: string | null;
  declare status: 'ACTIVE' | 'BLOCKED';
  declare roleId: string;
  declare vendorId: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

export const initUserModel = (sequelize: Sequelize) => {
  User.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING, unique: true, allowNull: false },
      passwordHash: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.ENUM('ACTIVE', 'BLOCKED'), defaultValue: 'ACTIVE' },
      roleId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'users', timestamps: true }
  );
  return User;
};
```

This pattern (`InferAttributes`/`InferCreationAttributes` + `declare`) gives full autocomplete and compile-time safety on every `User.create(...)`/`User.findOne(...)` call **without** switching to `sequelize-typescript` decorators — so your existing `sequelize-cli` migration workflow from Section 4.7 is untouched. Apply the same pattern to every model in Section 4; the migrations themselves stay plain JS/SQL since `sequelize-cli` migrations don't need typing.

---

## 3. Folder Structure (TypeScript, Layered per Module)

Each feature module follows the same internal shape — `routes → controller → service → repository`, plus its own `dto` (Zod schemas + inferred types) and `types` (domain interfaces). This is what keeps the codebase scalable as modules grow: every module is a self-contained unit, and cross-module calls only happen through a service's public interface (never reach into another module's repository directly).

```
backend/
├── src/
│   ├── config/                       # env.ts, db.ts, redis.ts, s3.ts, razorpay.ts — typed config objects
│   ├── core/                         # cross-cutting building blocks, no business logic
│   │   ├── errors/
│   │   │   ├── AppError.ts           # base error class
│   │   │   ├── NotFoundError.ts
│   │   │   ├── ValidationError.ts
│   │   │   └── ForbiddenError.ts
│   │   ├── http/
│   │   │   ├── ApiResponse.ts        # typed success/error response envelope
│   │   │   └── asyncHandler.ts       # wraps controllers, forwards rejections to errorHandler
│   │   ├── repository/
│   │   │   └── BaseRepository.ts     # generic CRUD over a Sequelize model
│   │   └── logger.ts                 # Winston instance, typed log methods
│   ├── middleware/
│   │   ├── auth.middleware.ts
│   │   ├── rbac.middleware.ts        # authorize('product.update')
│   │   ├── ownership.middleware.ts   # vendor can only touch own resources
│   │   ├── rateLimiter.middleware.ts
│   │   ├── validate.middleware.ts    # generic Zod-schema validator
│   │   └── errorHandler.middleware.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.dto.ts           # Zod schemas + z.infer<> request/response types
│   │   │   └── auth.types.ts         # domain types not tied to a request/response shape
│   │   ├── users/            (same shape)
│   │   ├── vendors/          (same shape)
│   │   ├── admin/            (same shape)
│   │   ├── products/         (same shape)
│   │   ├── categories/       (same shape)
│   │   ├── inventory/        (same shape)
│   │   ├── cart/             (same shape)
│   │   ├── orders/           (same shape)
│   │   ├── suborders/        (same shape)
│   │   ├── payments/         (same shape)
│   │   ├── shipping/         (same shape — see Section 10)
│   │   ├── returns/          (same shape — see Section 11)
│   │   ├── wallet/           (same shape — see Section 12)
│   │   ├── tax/              (same shape — see Section 13)
│   │   ├── coupons/          (same shape, + coupon-engine as an internal service)
│   │   ├── commissions/      (same shape)
│   │   ├── payouts/          (same shape)
│   │   ├── reviews/          (same shape — see Section 9)
│   │   ├── wishlist/         (same shape — see Section 9)
│   │   ├── search/           (same shape — see Section 7)
│   │   └── notifications/    (same shape — see Section 8)
│   ├── jobs/                          # BullMQ processors, one file per queue
│   │   ├── email.processor.ts
│   │   ├── payout.processor.ts
│   │   └── abandonedCart.processor.ts
│   ├── utils/                          # pure, stateless helper functions only
│   ├── uploads/                         # S3 upload helpers (multer-s3 config)
│   ├── routes/
│   │   └── index.ts                    # mounts all module routers under /api
│   ├── app.ts                          # Express app assembly (middleware, routes, error handler)
│   └── server.ts                       # HTTP server bootstrap, DB connect, graceful shutdown
├── database/                           # sequelize-cli root (per .sequelizerc)
│   ├── config/
│   │   └── config.ts                   # env-based DB configs (compiled/registered via ts-node for CLI)
│   ├── models/                         # typed Sequelize model classes + models/index.ts
│   ├── migrations/                     # sequelize-cli generated migration files (plain JS, untyped)
│   └── seeders/                        # Role/Permission seed data, demo data
├── .sequelizerc
├── tsconfig.json
├── .eslintrc.cjs
├── .prettierrc
├── tests/
│   ├── unit/                           # service-layer tests, repositories mocked
│   └── integration/                    # route-level tests against a test DB
└── package.json
```

**Why this shape scales:**
- **Repository layer isolates Sequelize.** Services never call `Model.findAll()` directly — they call a typed repository method. If you ever swap ORMs or add read replicas, only the repository layer changes.
- **`core/errors` + a single `errorHandler.middleware.ts`** means every module throws typed errors (`throw new NotFoundError('Product')`) and formatting/status-codes are handled in exactly one place.
- **DTOs own the request/response contract.** `auth.dto.ts` defines `LoginRequestSchema = z.object({...})` and exports `type LoginRequest = z.infer<typeof LoginRequestSchema>`. Controllers, services, and OpenAPI docs (if added later) all reference the same type — no drift between validation and TS types.
- **No cross-module repository access.** If `orders` needs product stock, it calls `productsService.reserveStock(...)`, not `ProductRepository` directly. This is what actually keeps a 20-module backend maintainable instead of turning into a shared-mutable-state mess.

**`.sequelizerc`** (points sequelize-cli at the `database/` structure above instead of the default `models`/`migrations` at project root):

```js
const path = require('path');
module.exports = {
  'config': path.resolve('database/config', 'config.js'),
  'models-path': path.resolve('database', 'models'),
  'seeders-path': path.resolve('database', 'seeders'),
  'migrations-path': path.resolve('database', 'migrations'),
};
```

> `sequelize-cli` itself runs on plain Node, so `.sequelizerc` and `database/config/config.js` stay `.js`. Only `database/models/*.ts` need TS-awareness at runtime — `ts-node`/`tsconfig-paths` (already wired into the `dev`/`start` scripts in Section 2.1) handles that; migrations don't need it since they run once via the CLI, not imported by app code.

### 3.1 Core Building Blocks (`src/core/`)

These four files are what most of the "maintainable and scalable" payoff comes from — every module reuses them instead of reinventing error handling, response shapes, or CRUD boilerplate.

```ts
// src/core/errors/AppError.ts
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// src/core/errors/NotFoundError.ts
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

// src/core/errors/ValidationError.ts
export class ValidationError extends AppError {
  constructor(details: unknown) {
    super('Validation failed', 422, 'VALIDATION_ERROR', details);
  }
}

// src/core/errors/ForbiddenError.ts
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}
```

```ts
// src/core/http/ApiResponse.ts — single response envelope used by every controller
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}
export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export const ok = <T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> => ({ success: true, data, meta });
```

```ts
// src/core/http/asyncHandler.ts — removes try/catch boilerplate from every controller
import { Request, Response, NextFunction, RequestHandler } from 'express';

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
```

```ts
// src/core/repository/BaseRepository.ts — generic CRUD so every module repository stays a few lines
import { Model, ModelStatic, WhereOptions, FindOptions, CreationAttributes } from 'sequelize';

export class BaseRepository<M extends Model> {
  constructor(protected readonly model: ModelStatic<M>) {}

  findById(id: string, options?: FindOptions<M>) {
    return this.model.findByPk(id, options);
  }

  findOne(where: WhereOptions<M>, options?: FindOptions<M>) {
    return this.model.findOne({ where, ...options });
  }

  findMany(options?: FindOptions<M>) {
    return this.model.findAll(options);
  }

  create(data: CreationAttributes<M>) {
    return this.model.create(data);
  }

  update(id: string, data: Partial<CreationAttributes<M>>) {
    return this.model.update(data, { where: { id } as WhereOptions<M> });
  }

  delete(id: string) {
    return this.model.destroy({ where: { id } as WhereOptions<M> });
  }
}
```

**Example module repository built on top of it** — this is the entire file for most modules:

```ts
// src/modules/products/products.repository.ts
import { BaseRepository } from '@core/repository/BaseRepository';
import { Product } from '@database/models/product.model';

export class ProductsRepository extends BaseRepository<Product> {
  constructor() {
    super(Product);
  }

  // Only module-specific queries go here; everything generic comes from BaseRepository
  findLiveByVendor(vendorId: string) {
    return this.model.findAll({ where: { vendorId, status: 'LIVE' } });
  }
}
```

```ts
// Controller pattern — thin, typed, no try/catch needed
// src/modules/products/products.controller.ts
import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ProductsService } from './products.service';
import { CreateProductSchema } from './products.dto';

const service = new ProductsService();

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateProductSchema.parse(req.body);           // throws ValidationError via validate.middleware
  const product = await service.createProduct(req.user!.vendorId, dto);
  res.status(201).json(ok(product));
});
```

This trio (`AppError` subclasses → thrown anywhere → caught once in `errorHandler.middleware.ts` → formatted into `ApiFailure`) is what lets 20+ modules stay consistent without copy-pasting error-formatting logic into every controller.

---

## 4. Database Schema (Sequelize Models + Migrations, TypeScript)

**Workflow:** every model is a typed class in `database/models/*.ts` using the `InferAttributes`/`InferCreationAttributes`/`declare` pattern introduced in Section 2.1 (no decorators — keeps `sequelize-cli` migrations untouched). A matching migration is generated via `sequelize-cli` (e.g. `npx sequelize-cli migration:generate --name create-users`) so schema changes stay versioned in plain JS migration files. UUIDs are primary keys throughout; enum-like fields use Postgres `ENUM` via `DataTypes.ENUM(...)`, typed as TS union literals on the class.

`database/models/index.ts` wires every model's `.init()` and calls `associate()` after all models are registered — same as the standard Sequelize bootstrap, just typed.

### 4.1 Core Identity & RBAC

```ts
// database/models/user.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare passwordHash: string;
  declare name: string;
  declare phone: string | null;
  declare status: 'ACTIVE' | 'BLOCKED';
  declare roleId: string;
  declare vendorId: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    User.belongsTo(models.Role, { foreignKey: 'roleId' });
    User.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    User.hasMany(models.Address, { foreignKey: 'userId' });
  }
}

export const initUserModel = (sequelize: Sequelize) => {
  User.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING, unique: true, allowNull: false },
      passwordHash: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.ENUM('ACTIVE', 'BLOCKED'), defaultValue: 'ACTIVE' },
      roleId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'users', timestamps: true }
  );
  return User;
};
```

```ts
// database/models/role.model.ts
// SUPER_ADMIN, ADMIN_STAFF, VENDOR_OWNER, VENDOR_STAFF, CUSTOMER
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Role extends Model<InferAttributes<Role>, InferCreationAttributes<Role>> {
  declare id: CreationOptional<string>;
  declare name: string;

  static associate(models: Record<string, any>) {
    Role.hasMany(models.User, { foreignKey: 'roleId' });
    Role.belongsToMany(models.Permission, { through: 'RolePermissions', foreignKey: 'roleId' });
  }
}

export const initRoleModel = (sequelize: Sequelize) => {
  Role.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, unique: true, allowNull: false },
    },
    { sequelize, tableName: 'roles', timestamps: true }
  );
  return Role;
};
```

```ts
// database/models/permission.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Permission extends Model<InferAttributes<Permission>, InferCreationAttributes<Permission>> {
  declare id: CreationOptional<string>;
  declare key: string; // e.g. 'product.create', 'order.refund', 'coupon.manage'

  static associate(models: Record<string, any>) {
    Permission.belongsToMany(models.Role, { through: 'RolePermissions', foreignKey: 'permissionId' });
  }
}

export const initPermissionModel = (sequelize: Sequelize) => {
  Permission.init(
    { id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, key: { type: DataTypes.STRING, unique: true, allowNull: false } },
    { sequelize, tableName: 'permissions', timestamps: false }
  );
  return Permission;
};
```

```ts
// database/models/address.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Address extends Model<InferAttributes<Address>, InferCreationAttributes<Address>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare line1: string;
  declare line2: string | null;
  declare city: string;
  declare state: string;
  declare country: string;
  declare pincode: string;
  declare isDefault: CreationOptional<boolean>;

  static associate(models: Record<string, any>) {
    Address.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initAddressModel = (sequelize: Sequelize) => {
  Address.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      line1: { type: DataTypes.STRING, allowNull: false },
      line2: { type: DataTypes.STRING, allowNull: true },
      city: { type: DataTypes.STRING, allowNull: false },
      state: { type: DataTypes.STRING, allowNull: false },
      country: { type: DataTypes.STRING, allowNull: false },
      pincode: { type: DataTypes.STRING, allowNull: false },
      isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    { sequelize, tableName: 'addresses', timestamps: true }
  );
  return Address;
};
```

### 4.2 Vendor

```ts
// database/models/vendor.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Vendor extends Model<InferAttributes<Vendor>, InferCreationAttributes<Vendor>> {
  declare id: CreationOptional<string>;
  declare businessName: string;
  declare slug: string;
  declare gstNumber: string | null;
  declare bankDetails: Record<string, unknown>; // store encrypted payload, not raw account numbers
  declare logoUrl: string | null;
  declare bannerUrl: string | null;
  declare description: string | null;
  declare status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  declare commissionRate: CreationOptional<number>; // % — overridable per category/product
  declare performanceScore: CreationOptional<number>;

  static associate(models: Record<string, any>) {
    Vendor.hasMany(models.User, { foreignKey: 'vendorId' });
    Vendor.hasMany(models.Product, { foreignKey: 'vendorId' });
    Vendor.hasMany(models.VendorDocument, { foreignKey: 'vendorId' });
  }
}

export const initVendorModel = (sequelize: Sequelize) => {
  Vendor.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      businessName: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, unique: true, allowNull: false },
      gstNumber: { type: DataTypes.STRING, allowNull: true },
      bankDetails: { type: DataTypes.JSONB, allowNull: false },
      logoUrl: { type: DataTypes.STRING, allowNull: true },
      bannerUrl: { type: DataTypes.STRING, allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'), defaultValue: 'PENDING' },
      commissionRate: { type: DataTypes.DECIMAL(5, 2), defaultValue: 10.0 },
      performanceScore: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 },
    },
    { sequelize, tableName: 'vendors', timestamps: true }
  );
  return Vendor;
};
```

```ts
// database/models/vendorDocument.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class VendorDocument extends Model<InferAttributes<VendorDocument>, InferCreationAttributes<VendorDocument>> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare type: 'GST_CERT' | 'PAN' | 'BANK_PROOF';
  declare url: string; // S3 object URL/key
  declare verified: CreationOptional<boolean>;

  static associate(models: Record<string, any>) {
    VendorDocument.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
  }
}

export const initVendorDocumentModel = (sequelize: Sequelize) => {
  VendorDocument.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.ENUM('GST_CERT', 'PAN', 'BANK_PROOF'), allowNull: false },
      url: { type: DataTypes.STRING, allowNull: false },
      verified: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    { sequelize, tableName: 'vendor_documents', timestamps: true }
  );
  return VendorDocument;
};
```

### 4.3 Catalog & Inventory

```ts
// database/models/category.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Category extends Model<InferAttributes<Category>, InferCreationAttributes<Category>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare slug: string;
  declare parentId: string | null;

  static associate(models: Record<string, any>) {
    Category.belongsTo(models.Category, { as: 'parent', foreignKey: 'parentId' });
    Category.hasMany(models.Category, { as: 'children', foreignKey: 'parentId' });
    Category.hasMany(models.Product, { foreignKey: 'categoryId' });
  }
}

export const initCategoryModel = (sequelize: Sequelize) => {
  Category.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, unique: true, allowNull: false },
      parentId: { type: DataTypes.UUID, allowNull: true },
    },
    { sequelize, tableName: 'categories', timestamps: true }
  );
  return Category;
};
```

```ts
// database/models/product.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional, NonAttribute } from 'sequelize';
import type { ProductVariant } from './productVariant.model';
import type { ProductImage } from './productImage.model';

export class Product extends Model<InferAttributes<Product>, InferCreationAttributes<Product>> {
  declare id: CreationOptional<string>;
  declare vendorId: string | null; // null = admin-owned product
  declare categoryId: string;
  declare name: string;
  declare slug: string;
  declare description: string;
  declare basePrice: number;
  declare status: 'DRAFT' | 'PENDING_APPROVAL' | 'LIVE' | 'REJECTED' | 'ARCHIVED';
  declare approvedById: string | null;
  declare rejectionNote: string | null;
  declare tags: CreationOptional<string[]>;
  declare avgRating: CreationOptional<number>;

  declare variants?: NonAttribute<ProductVariant[]>;
  declare images?: NonAttribute<ProductImage[]>;

  static associate(models: Record<string, any>) {
    Product.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    Product.belongsTo(models.Category, { foreignKey: 'categoryId' });
    Product.hasMany(models.ProductVariant, { foreignKey: 'productId', as: 'variants' });
    Product.hasMany(models.ProductImage, { foreignKey: 'productId', as: 'images' });
  }
}

export const initProductModel = (sequelize: Sequelize) => {
  Product.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      categoryId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, unique: true, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      basePrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      status: {
        type: DataTypes.ENUM('DRAFT', 'PENDING_APPROVAL', 'LIVE', 'REJECTED', 'ARCHIVED'),
        defaultValue: 'DRAFT',
      },
      approvedById: { type: DataTypes.UUID, allowNull: true },
      rejectionNote: { type: DataTypes.TEXT, allowNull: true },
      tags: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
      avgRating: { type: DataTypes.DECIMAL(3, 2), defaultValue: 0 },
    },
    { sequelize, tableName: 'products', timestamps: true }
  );
  return Product;
};
```

> **Note:** `search_vector` (Section 7) is a DB-generated `STORED` column added via a raw-SQL migration, not declared on the Sequelize model — it's write-only from the app's perspective (Postgres computes it), so there's no attribute for it here; the search repository queries it directly via `sequelize.query`.

```ts
// database/models/productVariant.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ProductVariant extends Model<InferAttributes<ProductVariant>, InferCreationAttributes<ProductVariant>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare sku: string;
  declare attributes: CreationOptional<Record<string, string>>; // { color: 'red', size: 'M' }
  declare price: number;
  declare stock: CreationOptional<number>;
  declare lowStockAt: CreationOptional<number>;

  static associate(models: Record<string, any>) {
    ProductVariant.belongsTo(models.Product, { foreignKey: 'productId' });
  }
}

export const initProductVariantModel = (sequelize: Sequelize) => {
  ProductVariant.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      sku: { type: DataTypes.STRING, unique: true, allowNull: false },
      attributes: { type: DataTypes.JSONB, defaultValue: {} },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      stock: { type: DataTypes.INTEGER, defaultValue: 0 },
      lowStockAt: { type: DataTypes.INTEGER, defaultValue: 5 },
    },
    { sequelize, tableName: 'product_variants', timestamps: true }
  );
  return ProductVariant;
};
```

```ts
// database/models/productImage.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ProductImage extends Model<InferAttributes<ProductImage>, InferCreationAttributes<ProductImage>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare url: string; // S3 object URL
  declare isPrimary: CreationOptional<boolean>;

  static associate(models: Record<string, any>) {
    ProductImage.belongsTo(models.Product, { foreignKey: 'productId' });
  }
}

export const initProductImageModel = (sequelize: Sequelize) => {
  ProductImage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      url: { type: DataTypes.STRING, allowNull: false },
      isPrimary: { type: DataTypes.BOOLEAN, defaultValue: false },
    },
    { sequelize, tableName: 'product_images', timestamps: false }
  );
  return ProductImage;
};
```

### 4.4 Cart & Orders (with Vendor Splitting)

```ts
// database/models/cart.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Cart extends Model<InferAttributes<Cart>, InferCreationAttributes<Cart>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  declare sessionId: string | null; // guest carts

  static associate(models: Record<string, any>) {
    Cart.hasMany(models.CartItem, { foreignKey: 'cartId', as: 'items' });
  }
}

export const initCartModel = (sequelize: Sequelize) => {
  Cart.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, unique: true, allowNull: true },
      sessionId: { type: DataTypes.STRING, unique: true, allowNull: true },
    },
    { sequelize, tableName: 'carts', timestamps: true }
  );
  return Cart;
};
```

```ts
// database/models/cartItem.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CartItem extends Model<InferAttributes<CartItem>, InferCreationAttributes<CartItem>> {
  declare id: CreationOptional<string>;
  declare cartId: string;
  declare variantId: string;
  declare quantity: CreationOptional<number>;

  static associate(models: Record<string, any>) {
    CartItem.belongsTo(models.Cart, { foreignKey: 'cartId' });
    CartItem.belongsTo(models.ProductVariant, { foreignKey: 'variantId' });
  }
}

export const initCartItemModel = (sequelize: Sequelize) => {
  CartItem.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      cartId: { type: DataTypes.UUID, allowNull: false },
      variantId: { type: DataTypes.UUID, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
    { sequelize, tableName: 'cart_items', timestamps: true }
  );
  return CartItem;
};
```

```ts
// database/models/order.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Order extends Model<InferAttributes<Order>, InferCreationAttributes<Order>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare couponId: string | null;
  declare totalAmount: number;
  declare discountTotal: CreationOptional<number>;
  declare status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
  declare paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  declare shippingAddressId: string;
  declare razorpayOrderId: string | null;    // returned from Razorpay Orders API
  declare razorpayPaymentId: string | null;  // set on webhook confirmation

  static associate(models: Record<string, any>) {
    Order.belongsTo(models.User, { foreignKey: 'userId' });
    Order.belongsTo(models.Coupon, { foreignKey: 'couponId' });
    Order.belongsTo(models.Address, { foreignKey: 'shippingAddressId' });
    Order.hasMany(models.SubOrder, { foreignKey: 'orderId', as: 'subOrders' });
  }
}

export const initOrderModel = (sequelize: Sequelize) => {
  Order.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      couponId: { type: DataTypes.UUID, allowNull: true },
      totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      discountTotal: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      status: {
        type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'),
        defaultValue: 'PENDING',
      },
      paymentStatus: { type: DataTypes.ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED'), defaultValue: 'PENDING' },
      shippingAddressId: { type: DataTypes.UUID, allowNull: false },
      razorpayOrderId: { type: DataTypes.STRING, allowNull: true },
      razorpayPaymentId: { type: DataTypes.STRING, allowNull: true },
    },
    { sequelize, tableName: 'orders', timestamps: true }
  );
  return Order;
};
```

```ts
// database/models/subOrder.model.ts — one SubOrder per vendor within a customer order
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class SubOrder extends Model<InferAttributes<SubOrder>, InferCreationAttributes<SubOrder>> {
  declare id: CreationOptional<string>;
  declare orderId: string;
  declare vendorId: string;
  declare status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
  declare subtotal: number;
  declare commissionAmount: CreationOptional<number>;
  declare trackingId: string | null;

  static associate(models: Record<string, any>) {
    SubOrder.belongsTo(models.Order, { foreignKey: 'orderId' });
    SubOrder.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    SubOrder.hasMany(models.OrderItem, { foreignKey: 'subOrderId', as: 'items' });
  }
}

export const initSubOrderModel = (sequelize: Sequelize) => {
  SubOrder.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      orderId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      status: {
        type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'),
        defaultValue: 'PENDING',
      },
      subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      commissionAmount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      trackingId: { type: DataTypes.STRING, allowNull: true },
    },
    { sequelize, tableName: 'sub_orders', timestamps: true }
  );
  return SubOrder;
};
```

```ts
// database/models/orderItem.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class OrderItem extends Model<InferAttributes<OrderItem>, InferCreationAttributes<OrderItem>> {
  declare id: CreationOptional<string>;
  declare subOrderId: string;
  declare variantId: string;
  declare productName: string; // snapshot at order time
  declare quantity: number;
  declare unitPrice: number;

  static associate(models: Record<string, any>) {
    OrderItem.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
    OrderItem.belongsTo(models.ProductVariant, { foreignKey: 'variantId' });
  }
}

export const initOrderItemModel = (sequelize: Sequelize) => {
  OrderItem.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      subOrderId: { type: DataTypes.UUID, allowNull: false },
      variantId: { type: DataTypes.UUID, allowNull: false },
      productName: { type: DataTypes.STRING, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false },
      unitPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    },
    { sequelize, tableName: 'order_items', timestamps: true }
  );
  return OrderItem;
};
```

### 4.5 Coupons

```ts
// database/models/coupon.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type CouponType = 'PERCENTAGE' | 'FLAT' | 'FREE_SHIPPING' | 'BOGO' | 'TIERED' | 'CASHBACK' | 'BUNDLE';

export interface CouponScope {
  type: 'category' | 'product' | 'vendor' | 'all';
  ids: string[];
}
export interface CouponUserRestriction {
  type: 'all' | 'specific' | 'segment' | 'firstOrder';
  value?: string | string[];
}

export class Coupon extends Model<InferAttributes<Coupon>, InferCreationAttributes<Coupon>> {
  declare id: CreationOptional<string>;
  declare code: string;
  declare type: CouponType;
  declare value: number | null;                 // % or flat amount depending on type
  declare maxDiscountCap: number | null;
  declare minOrderValue: number | null;
  declare minQuantity: number | null;

  declare applicableScope: CreationOptional<CouponScope>;
  declare excludedItems: CreationOptional<{ productIds: string[]; categoryIds: string[] }>;

  declare userRestriction: CreationOptional<CouponUserRestriction>;
  declare usageLimitTotal: number | null;
  declare usageLimitPerUser: CreationOptional<number>;
  declare usedCount: CreationOptional<number>;

  declare startDate: Date;
  declare endDate: Date;
  declare stackable: CreationOptional<boolean>;
  declare priority: CreationOptional<number>;
  declare status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ARCHIVED';

  declare createdById: string;
  declare vendorId: string | null; // vendor-scoped coupons

  static associate(models: Record<string, any>) {
    Coupon.belongsTo(models.User, { as: 'createdBy', foreignKey: 'createdById' });
    Coupon.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    Coupon.hasMany(models.CouponUsage, { foreignKey: 'couponId' });
  }
}

export const initCouponModel = (sequelize: Sequelize) => {
  Coupon.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      code: { type: DataTypes.STRING, unique: true, allowNull: false },
      type: {
        type: DataTypes.ENUM('PERCENTAGE', 'FLAT', 'FREE_SHIPPING', 'BOGO', 'TIERED', 'CASHBACK', 'BUNDLE'),
        allowNull: false,
      },
      value: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      maxDiscountCap: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      minOrderValue: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      minQuantity: { type: DataTypes.INTEGER, allowNull: true },
      applicableScope: { type: DataTypes.JSONB, defaultValue: {} },
      excludedItems: { type: DataTypes.JSONB, defaultValue: {} },
      userRestriction: { type: DataTypes.JSONB, defaultValue: {} },
      usageLimitTotal: { type: DataTypes.INTEGER, allowNull: true },
      usageLimitPerUser: { type: DataTypes.INTEGER, defaultValue: 1 },
      usedCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      startDate: { type: DataTypes.DATE, allowNull: false },
      endDate: { type: DataTypes.DATE, allowNull: false },
      stackable: { type: DataTypes.BOOLEAN, defaultValue: false },
      priority: { type: DataTypes.INTEGER, defaultValue: 0 },
      status: { type: DataTypes.ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED'), defaultValue: 'DRAFT' },
      createdById: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
    },
    { sequelize, tableName: 'coupons', timestamps: true }
  );
  return Coupon;
};
```

```ts
// database/models/couponUsage.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CouponUsage extends Model<InferAttributes<CouponUsage>, InferCreationAttributes<CouponUsage>> {
  declare id: CreationOptional<string>;
  declare couponId: string;
  declare userId: string;
  declare orderId: string;
  declare discountApplied: number;
  declare usedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    CouponUsage.belongsTo(models.Coupon, { foreignKey: 'couponId' });
    CouponUsage.belongsTo(models.User, { foreignKey: 'userId' });
    CouponUsage.belongsTo(models.Order, { foreignKey: 'orderId' });
  }
}

export const initCouponUsageModel = (sequelize: Sequelize) => {
  CouponUsage.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      couponId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      orderId: { type: DataTypes.UUID, allowNull: false },
      discountApplied: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      usedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    },
    {
      sequelize,
      tableName: 'coupon_usages',
      timestamps: false,
      indexes: [{ unique: true, fields: ['couponId', 'orderId'] }],
    }
  );
  return CouponUsage;
};
```

### 4.6 Commission & Payouts

```ts
// database/models/commissionLedger.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class CommissionLedger extends Model<InferAttributes<CommissionLedger>, InferCreationAttributes<CommissionLedger>> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare subOrderId: string;
  declare saleAmount: number;
  declare commissionRate: number;
  declare commissionAmount: number;
  declare status: 'PENDING' | 'SETTLED' | 'CLAWED_BACK';

  static associate(models: Record<string, any>) {
    CommissionLedger.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
    CommissionLedger.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
  }
}

export const initCommissionLedgerModel = (sequelize: Sequelize) => {
  CommissionLedger.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      subOrderId: { type: DataTypes.UUID, allowNull: false },
      saleAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      commissionRate: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      commissionAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      status: { type: DataTypes.ENUM('PENDING', 'SETTLED', 'CLAWED_BACK'), defaultValue: 'PENDING' },
    },
    { sequelize, tableName: 'commission_ledgers', timestamps: true }
  );
  return CommissionLedger;
};
```

```ts
// database/models/payout.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Payout extends Model<InferAttributes<Payout>, InferCreationAttributes<Payout>> {
  declare id: CreationOptional<string>;
  declare vendorId: string;
  declare amount: number;
  declare periodStart: Date;
  declare periodEnd: Date;
  declare status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
  declare razorpayPayoutId: string | null; // Razorpay Route/Payout reference
  declare paidAt: Date | null;

  static associate(models: Record<string, any>) {
    Payout.belongsTo(models.Vendor, { foreignKey: 'vendorId' });
  }
}

export const initPayoutModel = (sequelize: Sequelize) => {
  Payout.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      vendorId: { type: DataTypes.UUID, allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      periodStart: { type: DataTypes.DATE, allowNull: false },
      periodEnd: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.ENUM('PENDING', 'PROCESSING', 'PAID', 'FAILED'), defaultValue: 'PENDING' },
      razorpayPayoutId: { type: DataTypes.STRING, allowNull: true },
      paidAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, tableName: 'payouts', timestamps: true }
  );
  return Payout;
};
```

### 4.7 Reviews & Ratings

```ts
// database/models/review.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Review extends Model<InferAttributes<Review>, InferCreationAttributes<Review>> {
  declare id: CreationOptional<string>;
  declare productId: string;
  declare userId: string;
  declare orderItemId: string;        // proof of verified purchase — see 9.1
  declare rating: number;             // 1–5
  declare title: string | null;
  declare body: string;
  declare status: 'PENDING' | 'APPROVED' | 'REJECTED';
  declare helpfulCount: CreationOptional<number>;
  declare unhelpfulCount: CreationOptional<number>;

  static associate(models: Record<string, any>) {
    Review.belongsTo(models.Product, { foreignKey: 'productId' });
    Review.belongsTo(models.User, { foreignKey: 'userId' });
    Review.belongsTo(models.OrderItem, { foreignKey: 'orderItemId' });
    Review.hasMany(models.ReviewVote, { foreignKey: 'reviewId' });
  }
}

export const initReviewModel = (sequelize: Sequelize) => {
  Review.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      productId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      orderItemId: { type: DataTypes.UUID, allowNull: false, unique: true }, // one review per purchased item
      rating: { type: DataTypes.SMALLINT, allowNull: false, validate: { min: 1, max: 5 } },
      title: { type: DataTypes.STRING, allowNull: true },
      body: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'), defaultValue: 'PENDING' },
      helpfulCount: { type: DataTypes.INTEGER, defaultValue: 0 },
      unhelpfulCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    { sequelize, tableName: 'reviews', timestamps: true }
  );
  return Review;
};
```

```ts
// database/models/reviewVote.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ReviewVote extends Model<InferAttributes<ReviewVote>, InferCreationAttributes<ReviewVote>> {
  declare id: CreationOptional<string>;
  declare reviewId: string;
  declare userId: string;
  declare vote: 'HELPFUL' | 'UNHELPFUL';
}

export const initReviewVoteModel = (sequelize: Sequelize) => {
  ReviewVote.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      reviewId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      vote: { type: DataTypes.ENUM('HELPFUL', 'UNHELPFUL'), allowNull: false },
    },
    { sequelize, tableName: 'review_votes', timestamps: true, indexes: [{ unique: true, fields: ['reviewId', 'userId'] }] }
  );
  return ReviewVote;
};
```

### 4.8 Wishlist

```ts
// database/models/wishlist.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Wishlist extends Model<InferAttributes<Wishlist>, InferCreationAttributes<Wishlist>> {
  declare id: CreationOptional<string>;
  declare userId: string;

  static associate(models: Record<string, any>) {
    Wishlist.belongsTo(models.User, { foreignKey: 'userId' });
    Wishlist.hasMany(models.WishlistItem, { foreignKey: 'wishlistId', as: 'items' });
  }
}

export const initWishlistModel = (sequelize: Sequelize) => {
  Wishlist.init(
    { id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, userId: { type: DataTypes.UUID, unique: true, allowNull: false } },
    { sequelize, tableName: 'wishlists', timestamps: true }
  );
  return Wishlist;
};
```

```ts
// database/models/wishlistItem.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class WishlistItem extends Model<InferAttributes<WishlistItem>, InferCreationAttributes<WishlistItem>> {
  declare id: CreationOptional<string>;
  declare wishlistId: string;
  declare productId: string;
  declare priceAtAdd: number;   // snapshot — powers the PRICE_DROP_ALERT diff job from Section 8

  static associate(models: Record<string, any>) {
    WishlistItem.belongsTo(models.Wishlist, { foreignKey: 'wishlistId' });
    WishlistItem.belongsTo(models.Product, { foreignKey: 'productId' });
  }
}

export const initWishlistItemModel = (sequelize: Sequelize) => {
  WishlistItem.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      wishlistId: { type: DataTypes.UUID, allowNull: false },
      productId: { type: DataTypes.UUID, allowNull: false },
      priceAtAdd: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    },
    { sequelize, tableName: 'wishlist_items', timestamps: true, indexes: [{ unique: true, fields: ['wishlistId', 'productId'] }] }
  );
  return WishlistItem;
};
```

### 4.9 Shipping

```ts
// database/models/shippingZone.model.ts — groups pincodes/states that share rates & delivery estimates
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ShippingZone extends Model<InferAttributes<ShippingZone>, InferCreationAttributes<ShippingZone>> {
  declare id: CreationOptional<string>;
  declare name: string;               // 'Metro', 'Rest of India', 'Remote/NE States'
  declare states: CreationOptional<string[]>;
  declare pincodePrefixes: CreationOptional<string[]>; // for finer-grained zone matching than state alone
}

export const initShippingZoneModel = (sequelize: Sequelize) => {
  ShippingZone.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      name: { type: DataTypes.STRING, allowNull: false },
      states: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
      pincodePrefixes: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
    },
    { sequelize, tableName: 'shipping_zones', timestamps: true }
  );
  return ShippingZone;
};
```

```ts
// database/models/shippingRate.model.ts — vendorId null = platform default rate card
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ShippingRate extends Model<InferAttributes<ShippingRate>, InferCreationAttributes<ShippingRate>> {
  declare id: CreationOptional<string>;
  declare zoneId: string;
  declare vendorId: string | null;
  declare method: 'STANDARD' | 'EXPRESS';
  declare minWeightGrams: number;
  declare maxWeightGrams: number;
  declare price: number;
  declare estimatedDays: number;
  declare freeShippingThreshold: number | null; // order value above which shipping is waived
}

export const initShippingRateModel = (sequelize: Sequelize) => {
  ShippingRate.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      zoneId: { type: DataTypes.UUID, allowNull: false },
      vendorId: { type: DataTypes.UUID, allowNull: true },
      method: { type: DataTypes.ENUM('STANDARD', 'EXPRESS'), defaultValue: 'STANDARD' },
      minWeightGrams: { type: DataTypes.INTEGER, defaultValue: 0 },
      maxWeightGrams: { type: DataTypes.INTEGER, allowNull: false },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      estimatedDays: { type: DataTypes.INTEGER, allowNull: false },
      freeShippingThreshold: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    },
    { sequelize, tableName: 'shipping_rates', timestamps: true }
  );
  return ShippingRate;
};
```

```ts
// database/models/shipment.model.ts — one per SubOrder once it ships
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class Shipment extends Model<InferAttributes<Shipment>, InferCreationAttributes<Shipment>> {
  declare id: CreationOptional<string>;
  declare subOrderId: string;
  declare carrier: string;                // 'Shiprocket', 'Delhivery', ...
  declare trackingNumber: string;
  declare trackingUrl: string | null;
  declare status: 'PENDING' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED';
  declare estimatedDeliveryDate: Date | null;
  declare shippedAt: Date | null;
  declare deliveredAt: Date | null;

  static associate(models: Record<string, any>) {
    Shipment.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
  }
}

export const initShipmentModel = (sequelize: Sequelize) => {
  Shipment.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      subOrderId: { type: DataTypes.UUID, allowNull: false, unique: true },
      carrier: { type: DataTypes.STRING, allowNull: false },
      trackingNumber: { type: DataTypes.STRING, allowNull: false },
      trackingUrl: { type: DataTypes.STRING, allowNull: true },
      status: {
        type: DataTypes.ENUM('PENDING', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'),
        defaultValue: 'PENDING',
      },
      estimatedDeliveryDate: { type: DataTypes.DATE, allowNull: true },
      shippedAt: { type: DataTypes.DATE, allowNull: true },
      deliveredAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, tableName: 'shipments', timestamps: true }
  );
  return Shipment;
};
```

### 4.10 Returns & Refunds (RMA)

```ts
// database/models/returnRequest.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class ReturnRequest extends Model<InferAttributes<ReturnRequest>, InferCreationAttributes<ReturnRequest>> {
  declare id: CreationOptional<string>;
  declare subOrderId: string;
  declare orderItemId: string;
  declare userId: string;
  declare reason: string;
  declare reasonCode: 'DAMAGED' | 'WRONG_ITEM' | 'NOT_AS_DESCRIBED' | 'NO_LONGER_NEEDED' | 'OTHER';
  declare status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PICKUP_SCHEDULED' | 'RECEIVED' | 'REFUNDED' | 'CLOSED';
  declare refundAmount: number | null;
  declare resolvedById: string | null;   // admin/vendor staff who actioned it
  declare resolvedAt: Date | null;

  static associate(models: Record<string, any>) {
    ReturnRequest.belongsTo(models.SubOrder, { foreignKey: 'subOrderId' });
    ReturnRequest.belongsTo(models.OrderItem, { foreignKey: 'orderItemId' });
    ReturnRequest.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initReturnRequestModel = (sequelize: Sequelize) => {
  ReturnRequest.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      subOrderId: { type: DataTypes.UUID, allowNull: false },
      orderItemId: { type: DataTypes.UUID, allowNull: false },
      userId: { type: DataTypes.UUID, allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: false },
      reasonCode: { type: DataTypes.ENUM('DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'NO_LONGER_NEEDED', 'OTHER'), allowNull: false },
      status: {
        type: DataTypes.ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'PICKUP_SCHEDULED', 'RECEIVED', 'REFUNDED', 'CLOSED'),
        defaultValue: 'REQUESTED',
      },
      refundAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      resolvedById: { type: DataTypes.UUID, allowNull: true },
      resolvedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, tableName: 'return_requests', timestamps: true }
  );
  return ReturnRequest;
};
```

**Return workflow:** `REQUESTED` (customer, within the return window from `deliveredAt`) → vendor or admin `APPROVED`/`REJECTED` → if approved, `PICKUP_SCHEDULED` (courier reverse-pickup via the same carrier integration as Section 10) → `RECEIVED` at vendor's warehouse → `REFUNDED` (triggers Razorpay refund + `WalletLedger` entry if it was a cashback-funded order) → `CLOSED`. Each transition fires the matching `ORDER_RETURNED`/`REFUND_PROCESSED` notification from Section 8, and a rejected `CommissionLedger` entry is clawed back per Section 6.6.

### 4.11 Wallet & Cashback Ledger

```ts
// database/models/walletLedger.model.ts — referenced by CASHBACK coupons (Section 5.3) and return refunds
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class WalletLedger extends Model<InferAttributes<WalletLedger>, InferCreationAttributes<WalletLedger>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare type: 'CREDIT' | 'DEBIT';
  declare amount: number;
  declare balanceAfter: number;          // denormalized running balance for fast reads
  declare referenceType: string;         // 'Order', 'Coupon', 'ReturnRequest'
  declare referenceId: string;
  declare description: string;
  declare expiresAt: Date | null;        // cashback can be time-limited

  static associate(models: Record<string, any>) {
    WalletLedger.belongsTo(models.User, { foreignKey: 'userId' });
  }
}

export const initWalletLedgerModel = (sequelize: Sequelize) => {
  WalletLedger.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.ENUM('CREDIT', 'DEBIT'), allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      balanceAfter: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      referenceType: { type: DataTypes.STRING, allowNull: false },
      referenceId: { type: DataTypes.UUID, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, tableName: 'wallet_ledgers', timestamps: true }
  );
  return WalletLedger;
};
```

> **Concurrency note:** wallet balance changes must go through a single `WalletService.credit()/debit()` method that recomputes `balanceAfter` inside a row-locked transaction (`SELECT ... FOR UPDATE` on the user's latest ledger row, or a `SERIALIZABLE` transaction) — never let two concurrent requests compute `balanceAfter` from a stale read, or refunds and cashback can silently desync from the real balance.

### 4.12 Tax (GST)

```ts
// database/models/taxRule.model.ts — category-level GST rate; CGST/SGST vs IGST decided at checkout time
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class TaxRule extends Model<InferAttributes<TaxRule>, InferCreationAttributes<TaxRule>> {
  declare id: CreationOptional<string>;
  declare categoryId: string | null;     // null = platform default rate
  declare hsnCode: string | null;
  declare gstPercentage: number;         // e.g. 18.00
}

export const initTaxRuleModel = (sequelize: Sequelize) => {
  TaxRule.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      categoryId: { type: DataTypes.UUID, allowNull: true },
      hsnCode: { type: DataTypes.STRING, allowNull: true },
      gstPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    },
    { sequelize, tableName: 'tax_rules', timestamps: true }
  );
  return TaxRule;
};
```

Tax calculation logic lives in Section 13, not on the model — the model only stores rates; whether a sale splits into CGST+SGST or IGST depends on comparing the vendor's registered state to the shipping address at checkout time, which is request-time logic, not schema.

### 4.13 Migration Workflow

Models above are TypeScript, but migrations stay plain JS — `sequelize-cli` doesn't need typing for one-shot schema changes:

```bash
npx sequelize-cli migration:generate --name create-users
npx sequelize-cli db:migrate            # apply
npx sequelize-cli db:migrate:undo       # rollback last
npx sequelize-cli db:seed:all           # run seeders (Roles, Permissions, default admin)
```

In practice: hand-write the migration file to match the model's `init()` block exactly (types, `ENUM` values, `unique`, `references: { model: 'vendors', key: 'id' }, onDelete: 'CASCADE'`, indexes) — keeping the migration and the TS model in lockstep is a manual discipline, not something the tooling enforces automatically, so review both together in code review.

---
## 5. Advanced Coupon Engine — Implementation Design

### 5.1 Principle
Do **not** hardcode coupon logic into the checkout controller. Build a standalone `couponEngine` service that runs a **validation pipeline**, so rules can be added/removed without touching order code.

### 5.2 Pipeline Stages (`services/coupon/couponEngine.ts`)

```
validateCoupon(coupon, cart, user)
  1. Status check         → is coupon ACTIVE?
  2. Date check            → now between startDate/endDate?
  3. User eligibility      → matches userRestriction (specific/segment/firstOrder)?
  4. Usage limit check      → usedCount < usageLimitTotal?
                             → per-user usage < usageLimitPerUser? (query CouponUsage)
  5. Cart eligibility       → cart total >= minOrderValue?
                             → cart quantity >= minQuantity?
                             → applicableScope matches items in cart (category/product/vendor)?
                             → excludedItems not solely making up the cart?
  6. Stackability check     → if another coupon already applied and this one isn't stackable → reject
  7. Calculate discount     → based on type (see below)
  8. Apply maxDiscountCap   → cap the computed discount if set
  → return { valid: bool, discountAmount, reason (if invalid) }
```

### 5.3 Discount Calculation by Type

| Type | Logic |
|---|---|
| PERCENTAGE | `discount = cartTotal * (value/100)`, capped by `maxDiscountCap` |
| FLAT | `discount = value` (never exceeds cart total) |
| FREE_SHIPPING | Zero out shipping fee line item |
| BOGO | Identify cheapest eligible item in the qualifying set → discount its price fully or partially |
| TIERED | Evaluate cart total against tier breakpoints → apply matching tier's % |
| CASHBACK | Discount not applied at checkout; instead, credited to `WalletLedger` post-order-completion |
| BUNDLE | Check if all required SKUs are present in cart → apply configured bundle price/discount |

### 5.4 Multi-Vendor Coupon Handling
Since one order splits into multiple `SubOrder`s:
- A **vendor-scoped coupon** only discounts that vendor's sub-order.
- A **store-wide coupon** discount is prorated across sub-orders (proportional to each sub-order's subtotal) so commission calculations remain accurate per vendor.

```
proratedDiscount(subOrder) = totalDiscount * (subOrder.subtotal / order.subtotalBeforeDiscount)
```

### 5.5 Auto-Apply Coupons
At cart load, run all `ACTIVE` coupons with `applicableScope` matching cart contents and no code requirement through the pipeline; auto-apply the highest-priority valid one (unless user manually applies a different code).

### 5.6 Bulk Code Generation
For campaign coupons (e.g., 10,000 unique single-use codes):
- Background job generates codes (`CAMP-XXXXXXXX`, collision-checked against DB) and bulk-inserts as individual `Coupon` rows sharing the same rule config, `usageLimitTotal: 1`.

### 5.7 API Endpoints

```
POST   /api/admin/coupons                  # create
GET    /api/admin/coupons                  # list w/ filters (status, type, vendor)
PATCH  /api/admin/coupons/:id               # update
PATCH  /api/admin/coupons/:id/status        # activate/pause/archive
POST   /api/admin/coupons/bulk-generate     # generate N codes from a template
DELETE /api/admin/coupons/:id

POST   /api/vendor/coupons                  # vendor creates coupon scoped to own products (if allowed)

POST   /api/cart/coupon/apply               # { code } → runs validation pipeline
DELETE /api/cart/coupon/remove
GET    /api/cart/coupon/eligible            # returns auto-applicable coupons for current cart

GET    /api/admin/coupons/:id/analytics     # redemptions, revenue impact, conversion
```

---

## 6. Vendor & Admin Management — Implementation Design

### 6.1 RBAC Model
Permissions are granular strings checked via middleware, not hardcoded role checks:

```ts
// middleware/rbac.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { roleHasPermission } from '@modules/auth/auth.service';

export const authorize =
  (permissionKey: string) => async (req: Request, _res: Response, next: NextFunction) => {
    const hasPermission = await roleHasPermission(req.user!.roleId, permissionKey);
    if (!hasPermission) return next(new ForbiddenError());
    next();
  };
```

Seed default roles:
- `SUPER_ADMIN` → all permissions
- `ADMIN_ORDER_MANAGER` → `order.*`
- `ADMIN_CATALOG_MANAGER` → `product.*`, `category.*`
- `VENDOR_OWNER` → `product.create/update/delete (own)`, `suborder.manage (own)`, `payout.view (own)`
- `VENDOR_STAFF` → subset of `VENDOR_OWNER` permissions, assigned by vendor owner

### 6.2 Ownership Enforcement

```ts
// middleware/ownership.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { getResource, ResourceType } from '@core/repository/resourceLookup';

export const checkOwnership =
  (resourceType: ResourceType) => async (req: Request, _res: Response, next: NextFunction) => {
    if (req.user!.role.name === 'SUPER_ADMIN') return next(); // bypass
    const resource = await getResource(resourceType, req.params.id);
    if (resource.vendorId !== req.user!.vendorId) {
      return next(new ForbiddenError('Not your resource'));
    }
    next();
  };
```

Applied on all vendor-facing mutation routes:
```
PUT /api/products/:id   → authenticate, authorize('product.update'), checkOwnership('product'), controller
```

### 6.3 Vendor Onboarding Flow

```
1. POST /api/vendors/register        → creates Vendor(status=PENDING) + VENDOR_OWNER user
2. POST /api/vendors/:id/documents    → upload KYC docs
3. Admin: GET /api/admin/vendors?status=PENDING
4. Admin: PATCH /api/admin/vendors/:id/approve  |  /reject  (with reason)
5. On approval → send activation email, vendor can now log into vendor dashboard
```

### 6.4 Product Approval Workflow (configurable)

Two modes, toggle per platform config:
- **Trusted mode:** vendor products go LIVE immediately (`status: LIVE`)
- **Moderated mode:** vendor products start `PENDING_APPROVAL`, admin reviews:

```
PATCH /api/admin/products/:id/approve
PATCH /api/admin/products/:id/reject   { reason }
```

Vendors always create/edit under their own scope; admins can override/edit/unpublish any product with an audit trail entry (`ProductAuditLog`: who changed what, when).

### 6.5 Order Splitting Logic (Checkout Service)

```ts
// src/modules/orders/checkout.service.ts
import { sequelize } from '@database/models';
import { groupBy, sum } from 'lodash';
import type { Cart } from '@modules/cart/cart.types';
import type { User } from '@database/models/user.model';
import type { Address } from '@database/models/address.model';
import type { Coupon } from '@database/models/coupon.model';
import { proratedDiscount } from '@modules/coupons/coupon.utils';
import { getCommissionRate } from '@modules/commissions/commissions.service';

export async function createOrderFromCart(
  cart: Cart,
  user: User,
  shippingAddress: Address,
  appliedCoupon?: Coupon
) {
  return sequelize.transaction(async (t) => {
    const itemsByVendor = groupBy(cart.items, (item) => item.variant.product.vendorId);

    const order = await createOrder(
      { userId: user.id, shippingAddressId: shippingAddress.id, couponId: appliedCoupon?.id ?? null },
      { transaction: t }
    );

    for (const [vendorId, items] of Object.entries(itemsByVendor)) {
      const subtotal = sum(items.map((i) => i.price * i.quantity));
      const discount = appliedCoupon ? proratedDiscount(subtotal, cart.subtotal, appliedCoupon) : 0;

      const subOrder = await createSubOrder(
        { orderId: order.id, vendorId, subtotal, commissionAmount: subtotal * (await getCommissionRate(vendorId)) },
        { transaction: t }
      );

      await createOrderItems(subOrder.id, items, { transaction: t });
      await deductStock(items, { transaction: t });
      await createCommissionLedgerEntry(vendorId, subOrder.id, subtotal, { transaction: t });
    }

    return order;
  });
}
```

The whole function runs inside a single `sequelize.transaction(...)` — stock deduction, order creation, and commission ledger entries must succeed or fail together, so every repository call inside the loop passes the same `{ transaction: t }` option.

### 6.6 Commission & Payout Logic

- On `SubOrder.status = DELIVERED` (or after return window closes), `CommissionLedger` entry moves from `PENDING` → `SETTLED`.
- Scheduled BullMQ job (weekly/monthly cron) aggregates `SETTLED` ledger entries per vendor → creates a `Payout` record → triggers payout via Razorpay Route (split settlements to vendor-linked accounts) or manual bank transfer marking if a vendor isn't yet onboarded onto Route.
- Refunds after payout trigger a `CLAWED_BACK` ledger entry, deducted from the vendor's *next* payout cycle.

### 6.7 Vendor Dashboard Endpoints

```
GET /api/vendor/dashboard/summary          # revenue, orders, pending payouts
GET /api/vendor/products                   # own products only
GET /api/vendor/suborders?status=          # own sub-orders
PATCH /api/vendor/suborders/:id/status     # e.g., mark shipped + tracking ID
GET /api/vendor/payouts
GET /api/vendor/reviews                    # reviews on own products
```

### 6.8 Admin Oversight Endpoints

```
GET  /api/admin/vendors?status=&sort=performance
PATCH /api/admin/vendors/:id/suspend        { reason }
GET  /api/admin/analytics/platform          # GMV, top vendors, top categories
GET  /api/admin/analytics/vendor/:id        # fulfillment rate, return rate, rating
POST /api/admin/disputes/:id/resolve
GET  /api/admin/settings                    # global commission defaults, payout cycle config
PATCH /api/admin/settings
```

### 6.9 Audit Logging
Every admin action that mutates a vendor's or another user's resource writes to a generic `AuditLog`:

```ts
// database/models/auditLog.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<string>;
  declare actorId: string;
  declare action: string; // 'PRODUCT_UNPUBLISHED', 'VENDOR_SUSPENDED', 'COUPON_ARCHIVED'
  declare entityType: string;
  declare entityId: string;
  declare metadata: CreationOptional<Record<string, unknown>>;
  declare readonly createdAt: CreationOptional<Date>;
}

export const initAuditLogModel = (sequelize: Sequelize) => {
  AuditLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      actorId: { type: DataTypes.UUID, allowNull: false },
      action: { type: DataTypes.STRING, allowNull: false },
      entityType: { type: DataTypes.STRING, allowNull: false },
      entityId: { type: DataTypes.UUID, allowNull: false },
      metadata: { type: DataTypes.JSONB, defaultValue: {} },
      createdAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'audit_logs', timestamps: true, updatedAt: false }
  );
  return AuditLog;
};
```

---

## 7. Search Implementation — PostgreSQL Full-Text Search (Optimized)

No Elasticsearch/Algolia — everything runs on Postgres `tsvector`/`tsquery` plus `pg_trgm` for typo-tolerant/autocomplete queries. This is genuinely fast at e-commerce catalog scale (low-to-mid millions of products) as long as the indexing strategy below is followed; the mistake that kills Postgres search performance is relying on `ILIKE '%term%'` instead of proper vector indexes.

### 7.1 Extensions Required

```sql
-- migration: enable-search-extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram similarity, powers fuzzy/typo-tolerant + autocomplete
CREATE EXTENSION IF NOT EXISTS unaccent;  -- so "café" matches "cafe"
```

### 7.2 Generated `tsvector` Column with Weighting

Rather than computing the vector at query time (slow, can't be indexed well), add a **generated, stored column** that Postgres maintains automatically on insert/update — this is the single biggest win for search performance.

```sql
-- migration: add-search-vector-to-products
ALTER TABLE products ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', unaccent(coalesce(name, ''))), 'A') ||
  setweight(to_tsvector('english', unaccent(coalesce(tags_text, ''))), 'B') ||
  setweight(to_tsvector('english', unaccent(coalesce(description, ''))), 'C')
) STORED;

CREATE INDEX products_search_vector_idx ON products USING GIN (search_vector);
```

- **Weighting (`A`/`B`/`C`/`D`)** means a match in `name` ranks higher than a match buried in `description` — this is what makes results feel relevant instead of just "contains the word somewhere."
- `tags_text` is a plain-text projection of the `tags` array column (`array_to_string(tags, ' ')`) kept in sync via the same generated expression, or as a small trigger if you want tags searchable at higher weight than description.
- **`GENERATED ALWAYS ... STORED`** means the vector is precomputed and stored on disk — search queries never recompute it, they just scan the index.

### 7.3 Trigram Index for Autocomplete / Fuzzy Matching

`tsvector` handles "search for these words" well but doesn't help with partial-word autocomplete (`"iph"` → `"iPhone"`) or typo tolerance (`"iphon"` → `"iPhone"`). `pg_trgm` covers that gap:

```sql
-- migration: add-trigram-index-products-name
CREATE INDEX products_name_trgm_idx ON products USING GIN (name gin_trgm_ops);
```

```sql
-- autocomplete query — fast prefix + fuzzy match against the trigram index
SELECT id, name, similarity(name, :query) AS score
FROM products
WHERE name % :query               -- '%' operator = trigram similarity threshold match
  AND status = 'LIVE'
ORDER BY score DESC
LIMIT 10;
```

### 7.4 Supporting Indexes for Filtered Search

Full-text search is rarely used alone — it's always combined with category/price/vendor filters. Composite and partial indexes make the *combination* fast, not just the text match:

```sql
-- Only index LIVE products — PENDING/DRAFT/ARCHIVED never appear in search anyway
CREATE INDEX products_live_category_idx ON products (category_id) WHERE status = 'LIVE';
CREATE INDEX products_live_vendor_idx ON products (vendor_id) WHERE status = 'LIVE';

-- Range queries on price are extremely common alongside search
CREATE INDEX products_price_idx ON product_variants (price);

-- Composite index for the most common filter combo: category + price range, live products only
CREATE INDEX products_category_price_idx ON products (category_id, "basePrice") WHERE status = 'LIVE';
```

**Partial indexes matter here**: indexing only `WHERE status = 'LIVE'` keeps the index smaller and faster than indexing every row including drafts/archived products that search never touches.

### 7.5 Query Ranking (`ts_rank_cd`) with Filters

```sql
SELECT
  p.id, p.name, p."basePrice",
  ts_rank_cd(p.search_vector, query) AS rank
FROM products p, websearch_to_tsquery('english', :searchTerm) query
WHERE p.search_vector @@ query
  AND p.status = 'LIVE'
  AND (:categoryId IS NULL OR p.category_id = :categoryId)
  AND (:vendorId IS NULL OR p.vendor_id = :vendorId)
ORDER BY rank DESC
LIMIT :limit OFFSET :offset;
```

- **`websearch_to_tsquery`** (not `plainto_tsquery`/`to_tsquery`) is the right choice for user-typed search boxes — it natively understands quoted phrases, `-exclude`, and `OR`, the way Google-style search boxes behave, without you having to parse the query string yourself.
- **`ts_rank_cd`** (cover density ranking) rewards matches where query terms appear close together, which produces noticeably better relevance ordering than plain `ts_rank` for multi-word product searches.
- Filters (`category_id`, `vendor_id`, price range) stay as plain indexed `WHERE` clauses — Postgres' query planner will combine the GIN full-text index with the partial B-tree indexes from 7.4 automatically via a bitmap index scan; you don't need to hint this manually.

### 7.6 Search Service (TypeScript)

```ts
// src/modules/search/search.repository.ts
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';

export interface SearchParams {
  term: string;
  categoryId?: string;
  vendorId?: string;
  minPrice?: number;
  maxPrice?: number;
  limit: number;
  offset: number;
}

export interface SearchResultRow {
  id: string;
  name: string;
  basePrice: string;
  rank: number;
}

export class SearchRepository {
  async searchProducts(params: SearchParams): Promise<SearchResultRow[]> {
    return sequelize.query<SearchResultRow>(
      `
      SELECT p.id, p.name, p."basePrice", ts_rank_cd(p.search_vector, query) AS rank
      FROM products p, websearch_to_tsquery('english', :term) query
      WHERE p.search_vector @@ query
        AND p.status = 'LIVE'
        AND (:categoryId::uuid IS NULL OR p.category_id = :categoryId::uuid)
        AND (:vendorId::uuid IS NULL OR p.vendor_id = :vendorId::uuid)
        AND (:minPrice::numeric IS NULL OR p."basePrice" >= :minPrice::numeric)
        AND (:maxPrice::numeric IS NULL OR p."basePrice" <= :maxPrice::numeric)
      ORDER BY rank DESC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: {
          term: params.term,
          categoryId: params.categoryId ?? null,
          vendorId: params.vendorId ?? null,
          minPrice: params.minPrice ?? null,
          maxPrice: params.maxPrice ?? null,
          limit: params.limit,
          offset: params.offset,
        },
        type: QueryTypes.SELECT,
      }
    );
  }

  async autocomplete(term: string): Promise<{ id: string; name: string }[]> {
    return sequelize.query(
      `
      SELECT id, name
      FROM products
      WHERE name % :term AND status = 'LIVE'
      ORDER BY similarity(name, :term) DESC
      LIMIT 10
      `,
      { replacements: { term }, type: QueryTypes.SELECT }
    );
  }
}
```

Raw SQL via `sequelize.query` (rather than the Sequelize query builder) is intentional here — `tsvector`/`websearch_to_tsquery`/`ts_rank_cd` aren't expressible through Sequelize's operator API, and forcing it through the ORM would just add an unreadable translation layer for no benefit.

### 7.7 Keeping It Fast as the Catalog Grows

- **Pagination:** switch from `OFFSET` to **keyset pagination** (`WHERE rank < :lastRank OR (rank = :lastRank AND id > :lastId)`) once catalogs get large — `OFFSET` gets linearly slower on deep pages.
- **Popular/trending searches:** if you add a "trending searches" or "most searched terms" feature, back it with a small materialized view refreshed on a schedule (`REFRESH MATERIALIZED VIEW CONCURRENTLY`) rather than computing it live on every request.
- **`ANALYZE` after bulk imports:** since `search_vector` is a generated/stored column, run `ANALYZE products;` after any bulk CSV product import so the query planner's statistics stay accurate for the new data distribution.
- **Escape hatch, not a rewrite:** if you ever outgrow this (tens of millions of products, need for synonyms/ML ranking), the migration path is to add Elasticsearch/OpenSearch as a read-side index fed by CDC/triggers — Postgres stays the source of truth either way, so this section's schema doesn't need to change even if you add that later.

---



## 8. Notifications & Email Integration

### 8.1 Provider & Architecture

**Provider: AWS SES** — since S3 is already in the stack, staying on AWS keeps IAM/billing/infra in one place, and SES is cost-effective at transactional volume. (If deliverability at scale becomes a pain point later, Resend or Postmark are easy drop-in swaps behind the same adapter interface below — worth knowing as an escape hatch, not a day-1 decision.)

**Golden rule: no email is ever sent synchronously inside a request handler.** Every send goes through BullMQ:

```
Controller/Service → enqueue job (email:transactional or email:marketing queue)
                            │
                            ▼
                    BullMQ Worker (email.processor.ts)
                            │
                ┌───────────┴────────────┐
                ▼                        ▼
        Render template            Look up NotificationLog
        (React Email → HTML)       (idempotency check)
                │                        │
                └───────────┬────────────┘
                            ▼
                    AWS SES sendEmail()
                            │
                            ▼
                 Update NotificationLog (SENT/FAILED)
```

**Two separate queues, not one:**
- `email:transactional` — order confirmations, OTPs, payment receipts, shipping updates. High priority, low retry-delay, near-real-time.
- `email:marketing` — abandoned cart, price-drop, win-back. Lower priority, respects unsubscribe/marketing-consent, can tolerate minutes of delay.

Splitting these means a burst of abandoned-cart reminders can never delay someone's OTP or order confirmation — they're different BullMQ queues with different worker concurrency and priority settings.

### 8.2 Idempotency & Audit — `NotificationLog`

Every send is recorded before/after dispatch so retries (BullMQ auto-retries on failure) never double-send, and so support can answer "did the customer actually get this email."

```ts
// database/models/notificationLog.model.ts
import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type NotificationType =
  | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'WELCOME'
  | 'ORDER_CONFIRMATION' | 'VENDOR_NEW_ORDER' | 'PAYMENT_RECEIPT' | 'PAYMENT_FAILED'
  | 'SUBORDER_SHIPPED' | 'SUBORDER_DELIVERED' | 'REVIEW_REQUEST'
  | 'ORDER_CANCELLED' | 'ORDER_RETURNED' | 'REFUND_PROCESSED'
  | 'VENDOR_APPLICATION_RECEIVED' | 'VENDOR_APPROVED' | 'VENDOR_REJECTED' | 'VENDOR_SUSPENDED'
  | 'PRODUCT_APPROVED' | 'PRODUCT_REJECTED' | 'KYC_DOCUMENT_REJECTED'
  | 'LOW_STOCK_ALERT' | 'PAYOUT_PROCESSED' | 'PAYOUT_FAILED'
  | 'ABANDONED_CART' | 'PRICE_DROP_ALERT' | 'BACK_IN_STOCK' | 'ADMIN_NEW_VENDOR_PENDING';

export class NotificationLog extends Model<InferAttributes<NotificationLog>, InferCreationAttributes<NotificationLog>> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare type: NotificationType;
  declare referenceType: string;   // 'Order', 'SubOrder', 'Vendor', 'Payout', ...
  declare referenceId: string;     // the entity's id this notification is about
  declare channel: CreationOptional<'EMAIL' | 'SMS' | 'PUSH'>;
  declare status: 'PENDING' | 'SENT' | 'FAILED' | 'BOUNCED' | 'COMPLAINED';
  declare providerMessageId: string | null;
  declare error: string | null;
  declare sentAt: Date | null;
}

export const initNotificationLogModel = (sequelize: Sequelize) => {
  NotificationLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      referenceType: { type: DataTypes.STRING, allowNull: false },
      referenceId: { type: DataTypes.UUID, allowNull: false },
      channel: { type: DataTypes.ENUM('EMAIL', 'SMS', 'PUSH'), defaultValue: 'EMAIL' },
      status: { type: DataTypes.ENUM('PENDING', 'SENT', 'FAILED', 'BOUNCED', 'COMPLAINED'), defaultValue: 'PENDING' },
      providerMessageId: { type: DataTypes.STRING, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      tableName: 'notification_logs',
      timestamps: true,
      indexes: [
        // one-shot emails (OTP, order confirmation) can never fire twice for the same reference
        { unique: true, fields: ['type', 'referenceId'], where: { status: 'SENT' } },
      ],
    }
  );
  return NotificationLog;
};
```

> For recurring notification types (abandoned cart, price-drop) where you *do* want to send again later, the uniqueness check in the service layer includes a date bucket (e.g. `referenceId = cartId:2026-08-03`) rather than relying purely on the DB constraint — see 8.6.

### 8.3 Trigger Matrix — What Sends, When, To Whom

| Trigger Event | Recipient | Notification Type | Fired From | Urgency |
|---|---|---|---|---|
| User registers | Customer | `EMAIL_VERIFICATION` | `auth.service` post-signup | Transactional, immediate |
| Password reset requested | Customer | `PASSWORD_RESET` | `auth.service` | Transactional, immediate |
| Email verified | Customer | `WELCOME` | `auth.service` | Transactional, immediate |
| Order placed & payment confirmed | Customer | `ORDER_CONFIRMATION` | `checkout.service`, after DB commit | Transactional, immediate |
| Order placed & payment confirmed | Each vendor in the order | `VENDOR_NEW_ORDER` (one per `SubOrder`) | `checkout.service` | Transactional, immediate |
| Payment captured | Customer | `PAYMENT_RECEIPT` | Razorpay webhook handler | Transactional, immediate |
| Payment failed | Customer | `PAYMENT_FAILED` | Razorpay webhook handler | Transactional, immediate |
| `SubOrder.status → SHIPPED` | Customer | `SUBORDER_SHIPPED` (with tracking link) | `suborders.service` on status update | Transactional, immediate |
| `SubOrder.status → DELIVERED` | Customer | `SUBORDER_DELIVERED` | `suborders.service` | Transactional, immediate |
| 2 days after delivery | Customer | `REVIEW_REQUEST` | Delayed BullMQ job scheduled at delivery time | Marketing-adjacent, delayed |
| Order cancelled | Customer | `ORDER_CANCELLED` | `orders.service` | Transactional, immediate |
| Return approved/completed | Customer | `ORDER_RETURNED` | `orders.service` | Transactional, immediate |
| Refund issued | Customer | `REFUND_PROCESSED` | `payments.service`, on Razorpay refund webhook | Transactional, immediate |
| Cart inactive for N hours | Customer | `ABANDONED_CART` | Scheduled cron scanning `carts` | Marketing, respects opt-out |
| Wishlist item price drops / restocks | Customer | `PRICE_DROP_ALERT` / `BACK_IN_STOCK` | Scheduled cron diffing price/stock | Marketing, respects opt-out |
| Vendor submits registration | Vendor | `VENDOR_APPLICATION_RECEIVED` | `vendors.service` | Transactional, immediate |
| Vendor submits registration | Admin (internal) | `ADMIN_NEW_VENDOR_PENDING` | `vendors.service` | Transactional, immediate |
| Admin approves/rejects vendor | Vendor | `VENDOR_APPROVED` / `VENDOR_REJECTED` | Admin action in `admin.service` | Transactional, immediate |
| Admin suspends vendor | Vendor | `VENDOR_SUSPENDED` (with reason) | Admin action | Transactional, immediate |
| Admin approves/rejects product (moderated mode) | Vendor | `PRODUCT_APPROVED` / `PRODUCT_REJECTED` | Admin action | Transactional, immediate |
| Admin rejects a KYC document | Vendor | `KYC_DOCUMENT_REJECTED` | Admin action | Transactional, immediate |
| Variant stock ≤ `lowStockAt` | Vendor | `LOW_STOCK_ALERT` | Scheduled cron over `product_variants` | Batch, daily digest |
| Payout batch job completes | Vendor | `PAYOUT_PROCESSED` | `payouts` BullMQ job | Transactional, immediate |
| Payout attempt fails | Vendor + Admin | `PAYOUT_FAILED` | `payouts` BullMQ job | Transactional, immediate |

This table *is* the notification module's spec — every row becomes one method on `NotificationsService` and one email template.

### 8.4 Notifications Service (Typed, One Method per Email)

```ts
// src/modules/notifications/notifications.service.ts
import { transactionalQueue, marketingQueue } from './notifications.queues';
import type { NotificationType } from '@database/models/notificationLog.model';

interface EnqueueOptions {
  userId: string;
  type: NotificationType;
  referenceType: string;
  referenceId: string;
  templateData: Record<string, unknown>;
}

class NotificationsService {
  private enqueueTransactional(opts: EnqueueOptions) {
    return transactionalQueue.add(opts.type, opts, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });
  }

  private enqueueMarketing(opts: EnqueueOptions) {
    return marketingQueue.add(opts.type, opts, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
    });
  }

  // --- one typed method per row of the trigger matrix ---
  sendOrderConfirmation(userId: string, orderId: string, templateData: Record<string, unknown>) {
    return this.enqueueTransactional({ userId, type: 'ORDER_CONFIRMATION', referenceType: 'Order', referenceId: orderId, templateData });
  }

  sendVendorNewOrder(vendorUserId: string, subOrderId: string, templateData: Record<string, unknown>) {
    return this.enqueueTransactional({ userId: vendorUserId, type: 'VENDOR_NEW_ORDER', referenceType: 'SubOrder', referenceId: subOrderId, templateData });
  }

  sendSubOrderShipped(userId: string, subOrderId: string, templateData: Record<string, unknown>) {
    return this.enqueueTransactional({ userId, type: 'SUBORDER_SHIPPED', referenceType: 'SubOrder', referenceId: subOrderId, templateData });
  }

  sendAbandonedCartReminder(userId: string, cartId: string, templateData: Record<string, unknown>) {
    // date-bucketed referenceId so the same cart can trigger a fresh reminder on a later day
    const referenceId = `${cartId}:${new Date().toISOString().slice(0, 10)}`;
    return this.enqueueMarketing({ userId, type: 'ABANDONED_CART', referenceType: 'Cart', referenceId, templateData });
  }

  sendPayoutProcessed(vendorUserId: string, payoutId: string, templateData: Record<string, unknown>) {
    return this.enqueueTransactional({ userId: vendorUserId, type: 'PAYOUT_PROCESSED', referenceType: 'Payout', referenceId: payoutId, templateData });
  }

  // ...remaining methods follow the same pattern for every row in the trigger matrix
}

export const notificationsService = new NotificationsService();
```

Callers never touch templates or SES directly — e.g. `checkoutService` just calls `notificationsService.sendOrderConfirmation(order.userId, order.id, { items, total, shippingAddress })` right after the transaction commits.

### 8.5 Templates — React Email

Since the frontend is already React, **React Email** (JSX components that render to HTML/plain-text) is the natural fit — templates are previewable in isolation and reuse a single shared layout/brand component. (MJML is a reasonable alternative if you'd rather not pull React into the backend build, but React Email keeps one mental model across the stack.)

```
src/modules/notifications/templates/
├── layout/
│   └── BaseLayout.tsx           # header, footer, brand colors — every template wraps this
├── OrderConfirmationEmail.tsx
├── VendorNewOrderEmail.tsx
├── SubOrderShippedEmail.tsx
├── AbandonedCartEmail.tsx
├── PayoutProcessedEmail.tsx
└── ... one file per NotificationType
```

```tsx
// src/modules/notifications/templates/OrderConfirmationEmail.tsx
import { Html, Head, Body, Container, Text, Section } from '@react-email/components';
import { BaseLayout } from './layout/BaseLayout';

interface Props {
  customerName: string;
  orderId: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  total: number;
}

export default function OrderConfirmationEmail({ customerName, orderId, items, total }: Props) {
  return (
    <BaseLayout preview={`Your order #${orderId} is confirmed`}>
      <Text>Hi {customerName}, your order has been confirmed.</Text>
      <Section>
        {items.map((item) => (
          <Text key={item.name}>
            {item.quantity} × {item.name} — ₹{item.unitPrice}
          </Text>
        ))}
      </Section>
      <Text>Total: ₹{total}</Text>
    </BaseLayout>
  );
}
```

### 8.6 Worker — Render + Send + Log

```ts
// src/modules/notifications/notifications.processor.ts
import { Worker } from 'bullmq';
import { render } from '@react-email/render';
import { sesClient } from '@config/ses';
import { NotificationLog } from '@database/models/notificationLog.model';
import { templateRegistry } from './templates/registry'; // maps NotificationType → React component

export const transactionalWorker = new Worker('email:transactional', async (job) => {
  const { userId, type, referenceType, referenceId, templateData } = job.data;

  // idempotency: skip if already sent for this exact reference
  const existing = await NotificationLog.findOne({ where: { type, referenceId, status: 'SENT' } });
  if (existing) return;

  const log = await NotificationLog.create({ userId, type, referenceType, referenceId, status: 'PENDING' });

  try {
    const Template = templateRegistry[type];
    const html = await render(Template(templateData));
    const user = await getUserEmail(userId);

    const result = await sesClient.sendEmail({
      Destination: { ToAddresses: [user.email] },
      Message: { Subject: { Data: subjectFor(type, templateData) }, Body: { Html: { Data: html } } },
      Source: 'orders@yourdomain.com',
    });

    await log.update({ status: 'SENT', providerMessageId: result.MessageId, sentAt: new Date() });
  } catch (err) {
    await log.update({ status: 'FAILED', error: (err as Error).message });
    throw err; // rethrow so BullMQ applies its retry/backoff policy
  }
}, { concurrency: 10 });
```

### 8.7 Bounce / Complaint Handling

Configure an SES configuration set with bounce/complaint notifications routed to an SNS topic → a webhook endpoint (`POST /api/webhooks/ses`) that:
- Marks the `NotificationLog` row `BOUNCED`/`COMPLAINED`
- Sets a `emailSuppressed: true` flag on the `User` (add this column via a small migration) so future **marketing** sends skip that address automatically — transactional emails (order confirmations, OTPs) still attempt delivery since those are operationally required, not promotional.

### 8.8 Marketing Consent

Add `emailMarketingConsent: boolean` (default `false`, opt-in at signup or checkout) to `User`. `enqueueMarketing` in Section 8.4 checks this flag before enqueueing — `email:transactional` never checks it, since order/payment/vendor-status emails aren't optional marketing content.

### 8.9 SMS / Phone OTP Channel

Phone-based OTP (registration/login verification, or an OTP-only login option) is a separate channel from email, not a fallback — some events (order shipped, delivery OTP for high-value orders) genuinely warrant SMS in addition to or instead of email in the Indian market.

- **Provider:** any SMS gateway with an India DLT-registered sender ID (e.g. MSG91, Twilio's India routes require DLT registration too) — this is a compliance requirement for transactional SMS in India, not optional infra.
- **`NotificationLog.channel`** (already `'EMAIL' | 'SMS' | 'PUSH'` in Section 8.2) covers this without a schema change — an OTP send just creates a `channel: 'SMS'` log row instead of `'EMAIL'`.
- **Separate BullMQ queue** (`sms:transactional`) mirrors the email queue structure from 8.1 — same idempotency-via-`NotificationLog` pattern, same worker-based send-and-log flow, just calling the SMS provider's API instead of SES.
- **What actually goes over SMS** (keep this list short — SMS costs money per message and OTP-fatigue is real): phone/login OTP, order-out-for-delivery with a delivery OTP (common pattern for COD/high-value orders in India), and optionally a shipped/delivered ping for customers who've opted into SMS updates. Everything else (order confirmation detail, review requests, marketing) stays email-only.

```ts
// src/modules/notifications/sms.service.ts
export function sendOtp(phone: string, otp: string) {
  return smsQueue.add('OTP', { phone, type: 'EMAIL_VERIFICATION', templateData: { otp } }, { attempts: 3, backoff: { type: 'fixed', delay: 3000 } });
}
```

---
## 9. Reviews, Ratings & Wishlist — Implementation Design

### 9.1 Verified-Purchase Enforcement
A review requires a delivered `OrderItem` belonging to the reviewing user — this is why `Review.orderItemId` is `unique`: one review per purchased line item, not per product, so a customer who bought the same product twice can leave two reviews (once per purchase experience) but can't spam multiple reviews off a single order.

```ts
// src/modules/reviews/reviews.service.ts
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Review } from '@database/models/review.model';
import { recalculateProductRating } from './reviews.utils';

export async function createReview(userId: string, orderItemId: string, input: { rating: number; title?: string; body: string }) {
  const orderItem = await OrderItem.findByPk(orderItemId, { include: [{ model: SubOrder, include: ['order'] }] });
  if (!orderItem) throw new NotFoundError('OrderItem');
  if (orderItem.subOrder.order.userId !== userId) throw new ForbiddenError('Not your order');
  if (orderItem.subOrder.status !== 'DELIVERED') throw new ForbiddenError('Item not yet delivered');

  const review = await Review.create({ ...input, userId, orderItemId, productId: orderItem.variant.productId, status: 'PENDING' });
  return review;
}
```

### 9.2 Moderation
Toggle per platform config, same pattern as product approval (Section 6.4):
- **Auto-approve mode:** `status: 'APPROVED'` immediately.
- **Moderated mode:** starts `PENDING`; admin (or the owning vendor, if delegated) calls `PATCH /api/admin/reviews/:id/approve|reject`. Only `APPROVED` reviews are ever returned by product-detail queries or counted in rating aggregation.

### 9.3 Rating Aggregation
`Product.avgRating` is denormalized for fast product-list reads — recompute it whenever a review's status changes to/from `APPROVED`, inside the same transaction as the status update, not via a cron job (ratings should update the moment a review is approved, not on a delay):

```ts
export async function recalculateProductRating(productId: string, transaction: Transaction) {
  const [{ avg, count }] = await sequelize.query<{ avg: string; count: string }>(
    `SELECT AVG(rating)::numeric(3,2) as avg, COUNT(*) as count FROM reviews WHERE product_id = :productId AND status = 'APPROVED'`,
    { replacements: { productId }, type: QueryTypes.SELECT, transaction }
  );
  await Product.update({ avgRating: avg ?? 0 }, { where: { id: productId }, transaction });
}
```

### 9.4 Helpful/Unhelpful Votes
`POST /api/reviews/:id/vote` upserts a `ReviewVote` (unique on `reviewId`+`userId` — a user can change their vote but not vote twice) and increments/decrements `Review.helpfulCount`/`unhelpfulCount` atomically via `increment()`/`decrement()` rather than read-modify-write, to avoid lost updates under concurrent voting.

### 9.5 Wishlist Endpoints

```
GET    /api/wishlist                    # current user's wishlist with product previews
POST   /api/wishlist/items              { productId }
DELETE /api/wishlist/items/:productId
POST   /api/wishlist/items/:productId/move-to-cart   # atomic: add to cart, remove from wishlist
```

`move-to-cart` is a single service method wrapped in a transaction (`cartService.addItem` + `wishlistService.removeItem`), not two separate client-side calls — a failure partway through shouldn't leave the item in both places or neither.

### 9.6 Price-Drop / Back-in-Stock Job
A scheduled BullMQ job (hourly) compares each `WishlistItem.priceAtAdd` against the product's current price, and each out-of-stock wishlisted variant against current stock — any drop/restock enqueues the `PRICE_DROP_ALERT`/`BACK_IN_STOCK` notification from Section 8's trigger matrix, then updates `priceAtAdd` to the new price so the same drop isn't re-alerted tomorrow.

---

## 10. Shipping & Delivery — Implementation Design

### 10.1 Rate Calculation at Checkout
Given a shipping address and a `SubOrder`'s items, resolve a rate in this order:
1. Match the address (state, or pincode prefix for finer zones) to a `ShippingZone`.
2. Look for a vendor-specific `ShippingRate` for that zone + weight bracket + method; fall back to the platform default (`vendorId: null`) if the vendor hasn't set custom rates.
3. If `SubOrder.subtotal >= freeShippingThreshold`, shipping is waived regardless of the matched rate.

```ts
// src/modules/shipping/shipping.service.ts
export async function calculateShippingCost(params: {
  vendorId: string;
  address: { state: string; pincode: string };
  totalWeightGrams: number;
  subtotal: number;
  method: 'STANDARD' | 'EXPRESS';
}) {
  const zone = await findZoneForAddress(params.address);
  const rate =
    (await ShippingRate.findOne({ where: { zoneId: zone.id, vendorId: params.vendorId, method: params.method, ...weightRange(params.totalWeightGrams) } })) ??
    (await ShippingRate.findOne({ where: { zoneId: zone.id, vendorId: null, method: params.method, ...weightRange(params.totalWeightGrams) } }));

  if (!rate) throw new NotFoundError('ShippingRate for this zone/weight');
  if (rate.freeShippingThreshold && params.subtotal >= rate.freeShippingThreshold) return { cost: 0, estimatedDays: rate.estimatedDays };
  return { cost: rate.price, estimatedDays: rate.estimatedDays };
}
```

This runs **per `SubOrder`**, not once for the whole cart — each vendor's items may resolve to a different rate/carrier, and the customer sees a combined shipping total across sub-orders at checkout.

### 10.2 Carrier Integration (Shiprocket/Delhivery)
Abstract the carrier behind an interface so swapping providers later doesn't touch order/shipment logic:

```ts
// src/modules/shipping/carriers/CarrierAdapter.ts
export interface CarrierAdapter {
  createShipment(subOrder: SubOrder, address: Address): Promise<{ trackingNumber: string; trackingUrl: string; estimatedDeliveryDate: Date }>;
  getTrackingStatus(trackingNumber: string): Promise<{ status: Shipment['status']; lastUpdate: Date }>;
  createReversePickup(returnRequest: ReturnRequest): Promise<{ pickupId: string; scheduledDate: Date }>;
}

// src/modules/shipping/carriers/ShiprocketAdapter.ts
export class ShiprocketAdapter implements CarrierAdapter {
  async createShipment(subOrder, address) {
    const res = await shiprocketClient.post('/orders/create/adhoc', buildShiprocketPayload(subOrder, address));
    return { trackingNumber: res.data.awb_code, trackingUrl: res.data.tracking_url, estimatedDeliveryDate: res.data.etd };
  }
  // ...
}
```

`ShippingService` depends on `CarrierAdapter`, not `ShiprocketAdapter` directly, injected at module bootstrap — this is the same "swap the implementation without touching callers" pattern used for the SES email provider in Section 8.

### 10.3 Tracking Updates
Carriers push status via webhook (`POST /api/webhooks/shipping/:carrier`) rather than the app polling — verify the webhook signature per carrier's docs, map their status vocabulary to the `Shipment.status` enum, and update `Shipment` + fire `SUBORDER_SHIPPED`/`SUBORDER_DELIVERED` notifications on the relevant transitions. Fall back to a periodic reconciliation job (poll `getTrackingStatus` every few hours) in case a webhook is missed — never trust webhooks as the sole source of truth for something customers are actively waiting on.

### 10.4 Endpoints

```
GET  /api/shipping/rates?pincode=&weight=&method=      # quote before checkout (per vendor in cart)
GET  /api/orders/:id/tracking                          # aggregated tracking across all sub-orders
POST /api/webhooks/shipping/:carrier                    # carrier status push
GET  /api/vendor/shipping-rates                         # vendor's custom rate card (falls back to platform default if none set)
PUT  /api/vendor/shipping-rates/:id
```

---

## 11. Returns & Refunds Workflow (RMA) — Implementation Design

### 11.1 Return Window
Enforced at request time, not just documented — `ReturnRequest` creation checks `now() - subOrder.deliveredAt <= returnWindowDays` (a per-category or platform-default setting, since some categories like perishables/innerwear are commonly non-returnable — model this as a `Category.returnWindowDays` field, nullable meaning "not returnable").

### 11.2 State Machine

```
REQUESTED → APPROVED → PICKUP_SCHEDULED → RECEIVED → REFUNDED → CLOSED
         ↘ REJECTED
```

```ts
// src/modules/returns/returns.service.ts
const ALLOWED_TRANSITIONS: Record<ReturnRequest['status'], ReturnRequest['status'][]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PICKUP_SCHEDULED'],
  PICKUP_SCHEDULED: ['RECEIVED'],
  RECEIVED: ['REFUNDED'],
  REFUNDED: ['CLOSED'],
  REJECTED: [],
  CLOSED: [],
};

export async function transitionReturn(returnId: string, next: ReturnRequest['status'], actorId: string) {
  return sequelize.transaction(async (t) => {
    const rr = await ReturnRequest.findByPk(returnId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!rr) throw new NotFoundError('ReturnRequest');
    if (!ALLOWED_TRANSITIONS[rr.status].includes(next)) {
      throw new ValidationError(`Cannot move return from ${rr.status} to ${next}`);
    }
    await rr.update({ status: next, resolvedById: actorId, resolvedAt: next === 'CLOSED' ? new Date() : rr.resolvedAt }, { transaction: t });

    if (next === 'RECEIVED') await restockVariant(rr.orderItemId, { transaction: t }); // put inventory back
    if (next === 'REFUNDED') await processRefund(rr, { transaction: t });              // Razorpay refund + WalletLedger if applicable

    return rr;
  });
}
```

Explicitly enumerating `ALLOWED_TRANSITIONS` (rather than trusting the caller) means an admin action or a buggy client can never skip straight from `REQUESTED` to `REFUNDED` — every jump is validated server-side.

### 11.3 Refund Execution
`processRefund` branches on how the order was paid:
- **Razorpay payment:** call Razorpay's refund API with the original `payment_id`; the refund completes asynchronously — mark `ReturnRequest.status = REFUNDED` optimistically, then reconcile via the `refund.processed` webhook (Section 14.2) in case Razorpay's side takes longer.
- **Wallet-funded portion:** if the original order used wallet balance (from a `CASHBACK` coupon), refund that portion as a `WalletLedger` credit instead of back to the payment method — cashback shouldn't round-trip through a card refund.
- Refunding after a vendor payout has already gone out triggers the `CLAWED_BACK` `CommissionLedger` entry from Section 6.6, deducted from that vendor's next payout cycle.

### 11.4 Endpoints

```
POST   /api/orders/:orderItemId/return-request     { reasonCode, reason }
GET    /api/returns/:id
GET    /api/vendor/returns?status=                  # vendor's incoming return requests
PATCH  /api/vendor/returns/:id/approve | /reject
PATCH  /api/admin/returns/:id/transition            { status }   # admin override, any transition
```

---

## 12. Wallet & Cashback — Implementation Design

### 12.1 Credit/Debit Through One Gate
Every wallet mutation goes through `WalletService`, never a direct `WalletLedger.create()` from a controller — this is what keeps `balanceAfter` accurate under concurrency (see the locking note in Section 4.11):

```ts
// src/modules/wallet/wallet.service.ts
export async function credit(userId: string, amount: number, ref: { type: string; id: string }, description: string) {
  return sequelize.transaction(async (t) => {
    const last = await WalletLedger.findOne({ where: { userId }, order: [['createdAt', 'DESC']], transaction: t, lock: t.LOCK.UPDATE });
    const balanceAfter = Number(last?.balanceAfter ?? 0) + amount;
    return WalletLedger.create({ userId, type: 'CREDIT', amount, balanceAfter, referenceType: ref.type, referenceId: ref.id, description }, { transaction: t });
  });
}

export async function debit(userId: string, amount: number, ref: { type: string; id: string }, description: string) {
  return sequelize.transaction(async (t) => {
    const last = await WalletLedger.findOne({ where: { userId }, order: [['createdAt', 'DESC']], transaction: t, lock: t.LOCK.UPDATE });
    const currentBalance = Number(last?.balanceAfter ?? 0);
    if (currentBalance < amount) throw new ValidationError('Insufficient wallet balance');
    return WalletLedger.create({ userId, type: 'DEBIT', amount, balanceAfter: currentBalance - amount, referenceType: ref.type, referenceId: ref.id, description }, { transaction: t });
  });
}

export async function getBalance(userId: string) {
  const last = await WalletLedger.findOne({ where: { userId }, order: [['createdAt', 'DESC']] });
  return Number(last?.balanceAfter ?? 0);
}
```

### 12.2 Applying Wallet Balance at Checkout
Wallet balance is applied as a payment method alongside Razorpay, not as a coupon — the checkout flow lets the customer choose how much of their available balance to apply (up to the order total), debiting that amount and sending only the remainder to Razorpay. Debit and order-creation happen in the same transaction as the rest of checkout (Section 6.5) so a payment failure doesn't leave wallet balance debited with no matching order.

### 12.3 Expiry
For time-limited cashback (`WalletLedger.expiresAt`), a daily job sums any `CREDIT` entries past their `expiresAt` that haven't been fully consumed by later `DEBIT`s (FIFO consumption order) and writes an offsetting `DEBIT` with `referenceType: 'Expiry'` — expiry is itself a ledger entry, never a silent deletion, so the balance history stays auditable.

### 12.4 Endpoints

```
GET  /api/wallet/balance
GET  /api/wallet/transactions          # paginated ledger history
```

---

## 13. Tax Calculation (GST)

### 13.1 CGST+SGST vs IGST
Indian GST splits into CGST+SGST (intra-state) or IGST (inter-state), decided by comparing the **vendor's registered state** (add `Vendor.gstStateCode`, derived from their GST number) to the **shipping address's state** — this is checkout-time logic, computed per `SubOrder` since each vendor may be in a different state from the others in the same order:

```ts
// src/modules/tax/tax.service.ts
export function calculateTax(params: { vendorStateCode: string; shippingStateCode: string; taxableAmount: number; gstPercentage: number }) {
  const total = round2(params.taxableAmount * (params.gstPercentage / 100));
  if (params.vendorStateCode === params.shippingStateCode) {
    return { cgst: round2(total / 2), sgst: round2(total / 2), igst: 0, total };
  }
  return { cgst: 0, sgst: 0, igst: total, total };
}
```

### 13.2 Rate Resolution
`gstPercentage` is looked up per line item: `TaxRule` for the item's `categoryId`, falling back to the platform-default `TaxRule` (`categoryId: null`) if the category has no override. Store the resolved rate and computed CGST/SGST/IGST breakdown on the `OrderItem` at order-creation time (add `taxBreakdown: Json` column) — never recompute historical tax from current rates, since rates change over time and past invoices must stay accurate.

### 13.3 Invoice Generation
The per-vendor GST invoice (required for B2B/GST-registered customers, and generally good practice) is generated from the frozen `taxBreakdown` snapshot on each `OrderItem`, as a PDF attached to the `ORDER_CONFIRMATION`/`VENDOR_NEW_ORDER` emails from Section 8 — this is a new email attachment, not a new notification type.

### 13.4 Endpoints

```
GET   /api/admin/tax-rules
POST  /api/admin/tax-rules              { categoryId, hsnCode, gstPercentage }
PATCH /api/admin/tax-rules/:id
GET   /api/orders/:id/invoice           # PDF, generated from frozen taxBreakdown
```

---

## 14. Payments — Razorpay Integration Details

### 14.1 Order Creation & Payment Capture Flow

```
1. POST /api/checkout            → server creates Order(status=PENDING) + Razorpay Order via Orders API
2. Client                        → opens Razorpay Checkout with the razorpayOrderId
3. Razorpay                      → customer completes payment
4. Client                        → POST /api/checkout/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
5. Server                        → verifies signature (14.2), marks Order paymentStatus=PAID, fires ORDER_CONFIRMATION
6. Razorpay webhook (async)      → POST /api/webhooks/razorpay — authoritative confirmation, reconciles in case step 4 was skipped/spoofed
```

**Never trust step 4 alone** — it's a same-request UX confirmation, but the webhook in step 6 is the source of truth, since a client can close the tab or fake a request to that endpoint. Payment status only becomes final once the webhook's signature is verified.

### 14.2 Webhook Signature Verification

```ts
// src/modules/payments/razorpay.webhook.ts
import crypto from 'crypto';
import { asyncHandler } from '@core/http/asyncHandler';

function verifyRazorpaySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export const handleRazorpayWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const isValid = verifyRazorpaySignature(req.rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET!);
  if (!isValid) return res.status(400).json({ error: 'Invalid signature' });

  const event = JSON.parse(req.rawBody);
  await processRazorpayEvent(event); // idempotent — see 14.3
  res.status(200).json({ received: true });
});
```

> **Requires the raw request body**, not the JSON-parsed one — signature verification hashes the exact bytes Razorpay sent. Mount this route with `express.raw({ type: 'application/json' })` instead of the global `express.json()` middleware, before any body-parsing middleware touches it.

### 14.3 Idempotent Event Processing
Razorpay (like most webhook providers) can deliver the same event more than once. Guard with a small `WebhookEvent` log keyed on Razorpay's `event.id`:

```ts
export async function processRazorpayEvent(event: RazorpayEvent) {
  const [, created] = await WebhookEvent.findOrCreate({ where: { provider: 'razorpay', eventId: event.id }, defaults: { payload: event } });
  if (!created) return; // already processed this exact event

  switch (event.event) {
    case 'payment.captured': return handlePaymentCaptured(event.payload.payment.entity);
    case 'payment.failed': return handlePaymentFailed(event.payload.payment.entity);
    case 'refund.processed': return handleRefundProcessed(event.payload.refund.entity);
    // ...
  }
}
```

### 14.4 Razorpay Route — Vendor Payout Onboarding
Route requires each vendor to be onboarded as a **linked account** before they can receive split settlements:

```
1. Vendor approved (Section 6.3)     → POST to Razorpay's linked-account creation API with vendor.bankDetails
2. Store the returned account id     → Vendor.razorpayAccountId (add this column)
3. Payout batch job (Section 6.6)    → transfers to Vendor.razorpayAccountId via Route's Transfers API
4. If a vendor has no razorpayAccountId yet → payout job falls back to "manual bank transfer" status, flagged for admin follow-up (Section 6.6 already accounts for this fallback)
```

Route accounts have their own KYC requirements on Razorpay's side, independent of your platform's `VendorDocument` KYC (Section 6.3) — a vendor can be `APPROVED` on your platform while still pending on Razorpay's linked-account KYC, so `Vendor.razorpayAccountId` being null is a valid, expected state to handle gracefully rather than an error.

### 14.5 Endpoints

```
POST /api/checkout                     # creates Order + Razorpay Order
POST /api/checkout/verify              # client-side confirmation (UX only, not authoritative)
POST /api/webhooks/razorpay            # authoritative — raw body, signature-verified
POST /api/admin/vendors/:id/razorpay-account   # trigger Route linked-account creation
```

---
## 15. Guest Checkout & Cart Merge

### 15.1 Guest Cart Identity
An unauthenticated visitor gets a `Cart.sessionId` (a signed cookie value, not a raw incrementing id) the first time they add an item — no login required to browse or add to cart. `Cart.userId` stays null until they either log in or complete guest checkout with just an email + shipping address (no account created).

### 15.2 Merge on Login
When a guest with an active `sessionId` cart logs into (or registers for) an account that already has its own `userId` cart, the two must merge without ever silently dropping items:

```ts
// src/modules/cart/cart.service.ts
export async function mergeGuestCartIntoUserCart(sessionId: string, userId: string) {
  return sequelize.transaction(async (t) => {
    const guestCart = await Cart.findOne({ where: { sessionId }, include: ['items'], transaction: t });
    if (!guestCart || guestCart.items.length === 0) return;

    const [userCart] = await Cart.findOrCreate({ where: { userId }, defaults: { userId }, transaction: t });

    for (const guestItem of guestCart.items) {
      const existing = await CartItem.findOne({ where: { cartId: userCart.id, variantId: guestItem.variantId }, transaction: t });
      if (existing) {
        await existing.increment('quantity', { by: guestItem.quantity, transaction: t }); // combine quantities, don't overwrite
      } else {
        await CartItem.create({ cartId: userCart.id, variantId: guestItem.variantId, quantity: guestItem.quantity }, { transaction: t });
      }
    }
    await guestCart.destroy({ transaction: t }); // guest cart is now redundant
  });
}
```

Called from `auth.service` immediately after a successful login/registration, passing whatever `sessionId` cookie was present on the request — the merge is invisible to the user, they just see their cart already has what they added before logging in.

### 15.3 Guest Checkout (No Account)
`POST /api/checkout/guest` accepts `{ email, shippingAddress, cartId }` instead of relying on `req.user`. The resulting `Order.userId` points to a lightweight "guest user" record (an `User` row with no `passwordHash`, `status: 'GUEST'` — simplest way to keep every other model's `userId` foreign key uniform rather than making it nullable everywhere). If that email later registers a real account, offer an order-history claim flow (verify via the order confirmation email) rather than auto-merging, since email alone isn't a reliable identity proof.

---

## 16. Security Hardening

### 16.1 Middleware Stack (applied in `app.ts`, in this order)

```ts
// src/app.ts
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize'; // strips $/. keys — cheap insurance even on Postgres if any raw filters ever get built from user input

app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(compression());
app.use('/api/webhooks', express.raw({ type: 'application/json' })); // BEFORE json() — see Section 14.2
app.use(express.json({ limit: '1mb' }));
app.use(mongoSanitize());
app.use(globalRateLimiter);
app.use('/api', routes);
app.use(errorHandlerMiddleware); // always last
```

### 16.2 Rate Limiting — Tiered, Not Global-Only
A single global limiter isn't enough — auth endpoints need much tighter limits than general browsing:

```ts
// src/middleware/rateLimiter.middleware.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '@config/redis';

export const globalRateLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) }),
  windowMs: 15 * 60 * 1000,
  limit: 300,
});

export const authRateLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redisClient.call(...args) }),
  windowMs: 15 * 60 * 1000,
  limit: 5,                 // login/register/password-reset — brute-force resistant
  skipSuccessfulRequests: true,
});

export const couponApplyRateLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10 }); // slow down coupon brute-forcing
```

`RedisStore` (not the default in-memory store) is required in any multi-instance deployment — an in-memory limiter resets per-process and stops being a real limit once you run more than one Node process.

### 16.3 Input Validation & Sanitization
Every route body/query/params is parsed through a Zod schema via `validate.middleware.ts` **before** the controller runs — this is the same DTO pattern from Section 3, and it's what actually prevents malformed/malicious payloads from reaching services, not an afterthought:

```ts
// src/middleware/validate.middleware.ts
import { ZodSchema } from 'zod';
import { ValidationError } from '@core/errors/ValidationError';

export const validate = (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(new ValidationError(result.error.flatten()));
    req[source] = result.data;
    next();
  };
```

### 16.4 SQL Injection
Sequelize's parameterized queries (the ORM API, and `replacements` in raw `sequelize.query` calls — as used throughout Sections 7 and elsewhere) already prevent injection as long as user input is never string-concatenated into a raw query. Enforce this via code review/lint rule: **any raw SQL with template-literal interpolation of a variable is a blocker**, only `replacements`/`bind` parameters are acceptable.

### 16.5 Secrets & Environment
No secret (DB credentials, JWT signing key, Razorpay keys, SES credentials, S3 keys) is ever committed — `.env` is git-ignored, `config/env.ts` validates required vars are present **at boot** (fail fast, not at first use) via a Zod schema over `process.env`, and production secrets are injected via the deployment platform's secret manager (Section 19), not baked into the Docker image.

### 16.6 Authentication Hardening
- `passwordHash` via `bcrypt` with cost factor ≥ 12.
- Access tokens short-lived (15 min), refresh tokens longer-lived (7–30 days) and stored hashed in a `RefreshToken` table so a leaked DB dump doesn't hand out valid tokens directly — refresh rotation (issue a new refresh token on every use, invalidate the old one) so a stolen refresh token has a narrow reuse window.
- Account lockout after N failed logins (tracked via Redis counter keyed on email, separate from the IP-based `authRateLimiter` — an attacker rotating IPs still gets locked out per-account).

### 16.7 File Upload Validation
Multer-S3 uploads (product images, KYC docs) validate MIME type **and** magic-byte sniffing (not just the client-supplied `Content-Type`, which is trivially spoofable), enforce a max file size, and generate a new random S3 key server-side rather than trusting a client-supplied filename (prevents path traversal / overwrite of another object).

### 16.8 Ownership & RBAC
Already covered in Section 6.1–6.2 — repeated here as a security control, not just an access-control convenience: every vendor-facing mutation route must carry both `authorize()` and `checkOwnership()`, and this pairing should be a lint-enforced convention (a custom ESLint rule or a code-review checklist item) so a new module can't accidentally ship a vendor route that's missing the ownership check.

---

## 17. Testing Strategy

### 17.1 Unit Tests — Services, Repository Mocked
Pure business logic (coupon engine, tax calculation, discount math) is tested with the repository layer mocked, so tests run fast with no real DB:

```ts
// tests/unit/couponEngine.spec.ts
import { validateCoupon } from '@modules/coupons/couponEngine';

describe('couponEngine — PERCENTAGE coupon', () => {
  it('caps discount at maxDiscountCap', () => {
    const coupon = buildCoupon({ type: 'PERCENTAGE', value: 50, maxDiscountCap: 200 });
    const result = validateCoupon(coupon, buildCart({ subtotal: 1000 }), buildUser());
    expect(result.discountAmount).toBe(200); // 50% of 1000 = 500, capped to 200
  });

  it('rejects when cart is below minOrderValue', () => {
    const coupon = buildCoupon({ minOrderValue: 500 });
    const result = validateCoupon(coupon, buildCart({ subtotal: 300 }), buildUser());
    expect(result.valid).toBe(false);
  });
});
```

Keeping the coupon engine as pure functions (input → output, no DB calls inside the calculation itself — only the pipeline's eligibility *checks* touch the DB) is what makes this kind of test possible without spinning up Postgres; this was the design intent flagged back in the coupon engine section.

### 17.2 Integration Tests — Real Test DB, Real Routes
Checkout, order-splitting, and payment webhook handling are tested against a real (throwaway) Postgres instance via `supertest`, since the whole point is verifying transactional behavior across multiple tables:

```ts
// tests/integration/checkout.spec.ts
describe('POST /api/checkout', () => {
  beforeEach(async () => resetTestDatabase());

  it('splits a multi-vendor cart into separate SubOrders', async () => {
    const { cart, vendorA, vendorB } = await seedMultiVendorCart();
    const res = await request(app).post('/api/checkout').set('Authorization', authHeader).send({ cartId: cart.id, shippingAddressId: address.id });

    const order = await Order.findByPk(res.body.data.id, { include: ['subOrders'] });
    expect(order.subOrders).toHaveLength(2);
    expect(order.subOrders.map((s) => s.vendorId).sort()).toEqual([vendorA.id, vendorB.id].sort());
  });

  it('rolls back stock deduction if commission ledger creation fails', async () => {
    jest.spyOn(CommissionLedger, 'create').mockRejectedValueOnce(new Error('DB error'));
    const before = await ProductVariant.findByPk(variant.id);
    await request(app).post('/api/checkout').send(validPayload).expect(500);
    const after = await ProductVariant.findByPk(variant.id);
    expect(after.stock).toBe(before.stock); // transaction rolled back, stock untouched
  });
});
```

A separate `NODE_ENV=test` database (migrated fresh per test run, truncated between tests — `reset TestDatabase()` above) keeps integration tests isolated from dev data.

### 17.3 What Gets Which Kind of Test

| Layer | Test type | Why |
|---|---|---|
| Coupon engine, tax calc, discount math | Unit | Pure functions, no I/O — fast, exhaustive edge cases |
| Repositories | Skip (thin wrappers over Sequelize; integration tests cover them indirectly) | Testing a 3-line pass-through adds no value |
| Checkout, order splitting, refunds | Integration | The transactional/multi-table behavior *is* the thing being tested |
| Webhook signature verification | Unit | Pure crypto function, easy to test with fixed test vectors |
| RBAC/ownership middleware | Unit (mocked req/res/next) | Verify it calls `next(err)` vs `next()` correctly for each role/ownership combination |

### 17.4 CI Gate
`npm run typecheck && npm run lint && npm run test` runs on every PR — the fast TS 7 compiler (Section 2.1) means `typecheck` alone no longer dominates CI time the way it would have on TS 6.

---

## 18. Logging & Monitoring

### 18.1 Structured Logger

```ts
// src/core/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  defaultMeta: { service: 'ecommerce-backend' },
  transports: [new winston.transports.Console()],
});

// Typed helper so call sites don't scatter untyped metadata shapes
export const logError = (message: string, error: unknown, meta?: Record<string, unknown>) =>
  logger.error(message, { error: error instanceof Error ? { message: error.message, stack: error.stack } : error, ...meta });
```

JSON-formatted (not pretty-printed) logs are intentional — in production these feed a log aggregator (CloudWatch Logs if staying in the AWS ecosystem alongside S3/SES, or a hosted option like Better Stack/Datadog) that expects structured fields, not console-formatted text.

### 18.2 Request Tracing
Every request gets a `requestId` (via `crypto.randomUUID()`) attached in a first middleware, included in every log line for that request's lifecycle, and returned in the `X-Request-Id` response header — this is what lets support turn "the order confirmation email never arrived" into "grep this one requestId across the checkout, notification-enqueue, and worker logs" instead of guessing.

```ts
// src/middleware/requestId.middleware.ts
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id']?.toString() ?? randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});
```

### 18.3 Error Tracking
`errorHandler.middleware.ts` (Section 3's central error handler) reports unexpected (non-`AppError`, i.e. programmer/infra) errors to Sentry in addition to logging them — expected `AppError`s (a 404, a validation failure) are normal control flow and shouldn't page anyone, but an unhandled `TypeError` reaching the handler is a bug that needs visibility:

```ts
// src/middleware/errorHandler.middleware.ts
import * as Sentry from '@sentry/node';

export const errorHandlerMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    logger.warn(err.message, { code: err.code, requestId: req.requestId });
    return res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  Sentry.captureException(err, { extra: { requestId: req.requestId } });
  logError('Unhandled error', err, { requestId: req.requestId });
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
};
```

### 18.4 Operational Alerts (Beyond APM)
A few business-specific conditions deserve alerting, distinct from generic error-rate monitoring:
- BullMQ dead-letter growth (jobs exhausting retries — payment webhook processing failing repeatedly is a P1, not a warning)
- Payout batch job failures (Section 6.6/14.4) — money not moving is always urgent
- Vendor `razorpayAccountId` onboarding stuck >X days for an `APPROVED` vendor
- SES bounce/complaint rate crossing a threshold (risks the sending domain's reputation)

---

## 19. CI/CD & Deployment

### 19.1 Dockerfile (Multi-Stage)

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY database ./database
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY database/migrations ./database/migrations
COPY database/seeders ./database/seeders
COPY .sequelizerc ./
EXPOSE 3000
CMD ["node", "-r", "tsconfig-paths/register", "dist/server.js"]
```

Multi-stage keeps the final image free of `devDependencies`, TS source, and the compiler itself — only compiled `dist/` plus what's needed at runtime (migrations, for the release step below) ships.

### 19.2 CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: test, POSTGRES_DB: ecommerce_test }
        ports: ['5432:5432']
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run db:migrate
        env: { NODE_ENV: test }
      - run: npm test
```

### 19.3 Release Pipeline
On merge to `main`: build and push the Docker image (tagged with the git SHA), then run `sequelize-cli db:migrate` against production **as a separate, gated step** before the new image is deployed — migrations and app deploys are decoupled so a failed migration blocks the deploy instead of the new code running against an out-of-date schema.

### 19.4 Environment & Secrets
- Local dev: `.env` (git-ignored), loaded via `dotenv` only in non-production.
- Production: secrets (DB URL, `JWT_SECRET`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, AWS credentials) injected by the deployment platform's secret manager (e.g. AWS Secrets Manager/Parameter Store if deploying to ECS/EKS, or the platform's built-in secret store if using Render/Railway/Fly) — never in the Docker image or a checked-in config file.
- `config/env.ts` validates all required vars via a Zod schema at boot; the process exits immediately with a clear error if anything's missing, rather than failing confusingly on the first request that needs the missing var.

### 19.5 Graceful Shutdown
`server.ts` listens for `SIGTERM` and drains in-flight requests, closes the DB pool, and closes BullMQ workers cleanly before exiting — without this, a rolling deploy can kill a process mid-checkout-transaction.

---

## 20. API Documentation (OpenAPI)

### 20.1 Generation from Existing DTOs
Since every module already defines Zod schemas for request/response shapes (Section 3's DTO convention), `zod-to-openapi` derives an OpenAPI spec from the same schemas instead of hand-writing (and inevitably drifting from) separate API docs:

```ts
// src/modules/products/products.dto.ts
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
extendZodWithOpenApi(z);

export const CreateProductSchema = z.object({
  name: z.string().min(1).openapi({ example: 'Wireless Mouse' }),
  categoryId: z.string().uuid(),
  basePrice: z.number().positive(),
  description: z.string(),
}).openapi('CreateProductRequest');

export type CreateProductRequest = z.infer<typeof CreateProductSchema>;
```

### 20.2 Spec Assembly & Serving

```ts
// src/docs/openapi.ts
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { CreateProductSchema } from '@modules/products/products.dto';
// ...import every module's schemas

const registry = new OpenAPIRegistry();
registry.registerPath({
  method: 'post',
  path: '/api/products',
  request: { body: { content: { 'application/json': { schema: CreateProductSchema } } } },
  responses: { 201: { description: 'Product created' } },
});

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'E-Commerce Platform API', version: '1.0.0' },
});
```

```ts
// src/app.ts — served only outside production, or behind admin auth if kept in prod
import swaggerUi from 'swagger-ui-express';
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
}
```

### 20.3 Why This Matters for a 20+ Module Platform
With this many modules (auth, vendors, products, coupons, orders, reviews, wishlist, shipping, returns, wallet, tax, payments...), hand-maintained API docs go stale within weeks. Deriving the spec from the same Zod schemas that validate every request means the docs, the runtime validation, and the TypeScript types are three views of one source of truth — a DTO change is automatically reflected everywhere instead of needing three manual updates.

---
## 21. Build Roadmap (Suggested Phases)

| Phase | Scope |
|---|---|
| 1 | Project bootstrap: TypeScript/ESLint/Prettier config, Auth + RBAC + User/Vendor models, DB schema, base Express structure |
| 2 | Product catalog + categories + inventory (admin + vendor CRUD, ownership middleware) |
| 3 | Cart + guest checkout/session cart + cart merge-on-login |
| 4 | Checkout + Order splitting into SubOrders + tax calculation (GST) |
| 5 | Payment gateway integration (Razorpay: Orders, webhook verification, Route vendor onboarding) |
| 6 | Coupon engine (start with PERCENTAGE/FLAT/FREE_SHIPPING, then layer BOGO/TIERED/BUNDLE/CASHBACK) + Wallet ledger |
| 7 | Commission ledger + payout batch jobs |
| 8 | Shipping (rate calculation, carrier integration, tracking webhooks) + Returns/RMA workflow |
| 9 | Vendor dashboard + Admin oversight analytics |
| 10 | Search (Postgres full-text + trigram indexes), Reviews & Ratings, Wishlist |
| 11 | Notification system: BullMQ email + SMS queues, React Email templates, SES/SMS gateway integration, bounce/complaint webhook |
| 12 | API documentation (OpenAPI from DTOs), structured logging + error tracking |
| 13 | Hardening: tiered rate limiting, audit logs, security review |
| 14 | Testing pass (unit + integration coverage across all modules above) + CI/CD pipeline + load testing |

---

## 22. Next Steps
This doc is implementation-ready for Phase 1–3. Suggested next artifact: scaffold the actual Express project (folder structure + Sequelize models/migrations + first module: `auth`) so you're coding against this directly rather than re-deriving it.