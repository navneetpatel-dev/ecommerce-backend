/**
 * Who may upload files for which entity. Runs assertUploadAllowed against real
 * seeded users, products, returns and delivery agents; skips when Postgres (or the
 * seed data it needs) is unavailable.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { S3_ENTITY_TYPES, S3_PURPOSES } from '@core/s3';
import { AppError } from '@core/errors';
import { assertUploadAllowed, MAX_NEW_UPLOAD_DRAFTS_PER_DAY } from '../uploadAuthorization';
import { PresignSingleSchema } from '../uploads.dto';

type Actor = Parameters<typeof assertUploadAllowed>[0];

let ready = false;
let customer: Actor;
let otherCustomer: Actor;
let vendorOwner: Actor;
let otherVendorOwner: Actor | null = null;
let agent: Actor;
let ownProductId = '';
let otherVendorProductId = '';
let otherVendorId = '';
let customerReturnId = '';
let otherAgentId = '';

async function actorFor(where: string, params: Record<string, unknown> = {}): Promise<Actor | null> {
  const [row] = await sequelize.query<{
    id: string;
    vendorId: string | null;
    roleId: string;
    roleName: string;
    deliveryAgentId: string | null;
  }>(
    `SELECT u.id, u."vendorId", u."roleId", r.name AS "roleName", da.id AS "deliveryAgentId"
     FROM users u
     INNER JOIN roles r ON r.id = u."roleId"
     LEFT JOIN delivery_agents da ON da."userId" = u.id AND da."deletedAt" IS NULL
     WHERE u."deletedAt" IS NULL AND ${where}
     ORDER BY u.id
     LIMIT 1`,
    { replacements: params, type: QueryTypes.SELECT },
  );
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendorId,
    deliveryAgentId: row.deliveryAgentId,
    roleId: row.roleId,
    role: { name: row.roleName },
  };
}

const forbidden = (err: unknown) => err instanceof ForbiddenError;

describe('upload authorization', () => {
  before(async () => {
    try {
      await Promise.race([
        sequelize.authenticate(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
    } catch {
      return;
    }

    const [ret] = await sequelize.query<{ id: string; userId: string }>(
      `SELECT rr.id, o."userId"
       FROM return_requests rr
       INNER JOIN sub_orders so ON so.id = rr."subOrderId"
       INNER JOIN orders o ON o.id = so."orderId"
       WHERE rr."deletedAt" IS NULL
       ORDER BY rr.id LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    const owner = await actorFor(`r.name = 'VENDOR_OWNER' AND u."vendorId" IS NOT NULL`);
    const agentActor = await actorFor(`da.id IS NOT NULL`);
    if (!ret || !owner || !agentActor) return;

    customerReturnId = ret.id;
    customer = (await actorFor('u.id = :id', { id: ret.userId }))!;
    otherCustomer = (await actorFor(`r.name = 'CUSTOMER' AND u.id <> :id`, { id: ret.userId }))!;
    vendorOwner = owner;
    agent = agentActor;

    const [own] = await sequelize.query<{ id: string }>(
      `SELECT id FROM products WHERE "vendorId" = :vendorId AND "deletedAt" IS NULL LIMIT 1`,
      { replacements: { vendorId: owner.vendorId }, type: QueryTypes.SELECT },
    );
    const [other] = await sequelize.query<{ id: string; vendorId: string }>(
      `SELECT id, "vendorId" FROM products
       WHERE "vendorId" <> :vendorId AND "deletedAt" IS NULL LIMIT 1`,
      { replacements: { vendorId: owner.vendorId }, type: QueryTypes.SELECT },
    );
    const [otherAgent] = await sequelize.query<{ id: string }>(
      `SELECT id FROM delivery_agents WHERE id <> :id AND "deletedAt" IS NULL LIMIT 1`,
      { replacements: { id: agentActor.deliveryAgentId }, type: QueryTypes.SELECT },
    );
    if (!own || !other || !otherAgent || !otherCustomer) return;
    ownProductId = own.id;
    otherVendorProductId = other.id;
    otherVendorId = other.vendorId;
    otherAgentId = otherAgent.id;
    otherVendorOwner = await actorFor(
      `r.name = 'VENDOR_OWNER' AND u."vendorId" IS NOT NULL AND u."vendorId" <> :vendorId`,
      { vendorId: owner.vendorId },
    );
    ready = true;
  });

  it('lets a user upload only their own avatar', async (t) => {
    if (!ready) return t.skip('database or seed data unavailable');
    await assertUploadAllowed(customer, S3_ENTITY_TYPES.USERS, customer.id, S3_PURPOSES.AVATAR);
    await assert.rejects(
      assertUploadAllowed(customer, S3_ENTITY_TYPES.USERS, otherCustomer.id, S3_PURPOSES.AVATAR),
      forbidden,
    );
  });

  it('lets a vendor upload images for its own and draft products only', async (t) => {
    if (!ready) return t.skip('database or seed data unavailable');
    await assertUploadAllowed(vendorOwner, S3_ENTITY_TYPES.PRODUCTS, ownProductId, S3_PURPOSES.IMAGES);
    await assertUploadAllowed(vendorOwner, S3_ENTITY_TYPES.PRODUCTS, randomUUID(), S3_PURPOSES.IMAGES);
    await assert.rejects(
      assertUploadAllowed(vendorOwner, S3_ENTITY_TYPES.PRODUCTS, otherVendorProductId, S3_PURPOSES.IMAGES),
      forbidden,
    );
  });

  it('keeps customers out of product media and other vendors’ KYC', async (t) => {
    if (!ready) return t.skip('database or seed data unavailable');
    await assert.rejects(
      assertUploadAllowed(customer, S3_ENTITY_TYPES.PRODUCTS, randomUUID(), S3_PURPOSES.IMAGES),
      forbidden,
    );
    await assert.rejects(
      assertUploadAllowed(vendorOwner, S3_ENTITY_TYPES.VENDORS, otherVendorId, S3_PURPOSES.KYC),
      forbidden,
    );
  });

  it('lets only the ordering customer add photos to an existing return', async (t) => {
    if (!ready) return t.skip('database or seed data unavailable');
    await assertUploadAllowed(customer, S3_ENTITY_TYPES.RETURNS, customerReturnId, S3_PURPOSES.PHOTOS);
    await assert.rejects(
      assertUploadAllowed(otherCustomer, S3_ENTITY_TYPES.RETURNS, customerReturnId, S3_PURPOSES.PHOTOS),
      forbidden,
    );
  });

  it('lets a delivery agent upload KYC documents only for itself', async (t) => {
    if (!ready) return t.skip('database or seed data unavailable');
    await assertUploadAllowed(
      agent,
      S3_ENTITY_TYPES.DELIVERY_AGENT_DOCUMENTS,
      agent.deliveryAgentId!,
      S3_PURPOSES.KYC,
    );
    await assert.rejects(
      assertUploadAllowed(agent, S3_ENTITY_TYPES.DELIVERY_AGENT_DOCUMENTS, otherAgentId, S3_PURPOSES.KYC),
      forbidden,
    );
  });

  it('rejects a non-UUID entityId before authorization runs', () => {
    const base = {
      entityType: S3_ENTITY_TYPES.PRODUCTS,
      purpose: S3_PURPOSES.IMAGES,
      filename: 'a.png',
      contentType: 'image/png',
      contentLength: 10,
    };
    assert.equal(PresignSingleSchema.safeParse({ ...base, entityId: randomUUID() }).success, true);
    for (const entityId of ['abc', `${randomUUID()}/../x`, '']) {
      assert.equal(PresignSingleSchema.safeParse({ ...base, entityId }).success, false, entityId);
    }
  });

  describe('draft ids', () => {
    const claimed: string[] = [];
    after(async () => {
      if (claimed.length === 0) return;
      await sequelize.query(`DELETE FROM upload_drafts WHERE "entityId" IN (:ids)`, {
        replacements: { ids: claimed },
      });
    });
    const draftId = () => {
      const id = randomUUID();
      claimed.push(id);
      return id;
    };

    it("belong to the vendor who started them; another vendor can't upload into one", async (t) => {
      if (!ready || !otherVendorOwner) return t.skip('database or seed data unavailable');
      const draft = draftId();
      await assertUploadAllowed(vendorOwner, S3_ENTITY_TYPES.PRODUCTS, draft, S3_PURPOSES.IMAGES);
      await assertUploadAllowed(vendorOwner, S3_ENTITY_TYPES.PRODUCTS, draft, S3_PURPOSES.VIDEO);
      await assert.rejects(
        assertUploadAllowed(otherVendorOwner, S3_ENTITY_TYPES.PRODUCTS, draft, S3_PURPOSES.IMAGES),
        forbidden,
      );
    });

    it("belong to the customer who started them for returns", async (t) => {
      if (!ready) return t.skip('database or seed data unavailable');
      const draft = draftId();
      await assertUploadAllowed(customer, S3_ENTITY_TYPES.RETURNS, draft, S3_PURPOSES.PHOTOS);
      await assert.rejects(
        assertUploadAllowed(otherCustomer, S3_ENTITY_TYPES.RETURNS, draft, S3_PURPOSES.PHOTOS),
        forbidden,
      );
    });

    it('are capped per user per day', async (t) => {
      if (!ready) return t.skip('database or seed data unavailable');
      const ids = Array.from({ length: MAX_NEW_UPLOAD_DRAFTS_PER_DAY }, draftId);
      await sequelize.query(
        `INSERT INTO upload_drafts ("entityType", "entityId", "userId")
         SELECT 'returns', id::uuid, :userId FROM unnest(ARRAY[:ids]::text[]) AS id`,
        { replacements: { ids, userId: otherCustomer.id } },
      );
      await assert.rejects(
        assertUploadAllowed(otherCustomer, S3_ENTITY_TYPES.RETURNS, draftId(), S3_PURPOSES.PHOTOS),
        (err: unknown) => err instanceof AppError && err.statusCode === 429,
      );
      // An existing draft of theirs still works; only starting new ones is capped.
      await assertUploadAllowed(otherCustomer, S3_ENTITY_TYPES.RETURNS, ids[0]!, S3_PURPOSES.PHOTOS);
    });
  });
});
