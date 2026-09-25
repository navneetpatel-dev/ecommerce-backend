import bcrypt from 'bcrypt';
import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { Shipment } from '@database/models/shipment.model';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { ShipmentAttempt } from '@database/models/shipmentAttempt.model';
import { SubOrder } from '@database/models/subOrder.model';
import { DeliveryCashDeposit } from '@database/models/deliveryCashDeposit.model';
import { DeliveryAgentEarning } from '@database/models/deliveryAgentEarning.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { DeliveryAgentDocument } from '@database/models/deliveryAgentDocument.model';
import { DeliveryRating } from '@database/models/deliveryRating.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { AuditLog } from '@database/models/auditLog.model';
import { NotFoundError, ValidationError } from '@core/errors';
import { ERROR_MESSAGES } from '@core/constants/errors';
import {
  DELIVERY_AGENT_REQUIRED_DOCUMENT_TYPES,
  RETURN_STATUS,
  RETURN_TYPE,
  ROLES,
  USER_STATUS,
} from '@core/constants/statuses';
import { buildPaginationMeta } from '@core/http/pagination';
import { clearPermissionCache } from '@middleware/rbac.middleware';
import { logAudit } from '@modules/audit/audit.service';
import { shippingService } from '@modules/shipping/shipping.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { OTP_TTL_MINUTES, otpService } from '@modules/auth/otp.service';
import { settingsService } from '@modules/settings/settings.service';
import { fromPaise, roundMoney, sumRupees, toPaise } from '@modules/pricing/money';
import { emitShipmentLocation } from '@realtime/socket';
import type {
  BulkAssignShipmentsRequest,
  CreateDeliveryAgentRequest,
  ListDeliveryAgentsRequest,
  ReviewDocumentRequest,
  SubmitDocumentRequest,
  UpdateDeliveryAgentRequest,
} from './deliveryAgents.dto';
import { deliveryAgentsRepository as repo } from './deliveryAgents.repository';
import { deliveryAgentPayoutsService } from './deliveryAgentPayouts.service';
import { deliveryRatingsService } from './deliveryRatings.service';

const DELIVERY_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'FAILED'],
  OUT_FOR_DELIVERY: ['FAILED'],
  FAILED: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'],
  RTO_INITIATED: ['RTO_DELIVERED'],
};

function assertDeliveryTransition(from: string, to: string) {
  if (!DELIVERY_TRANSITIONS[from]?.includes(to)) {
    throw new ValidationError({ status: [`Cannot move a delivery from ${from} to ${to}`] });
  }
}

function customerIdFromShipment(shipment: Shipment): string | null {
  return (shipment as any).subOrder?.order?.userId ?? null;
}

/** How long a shipment/pickup can sit mid-transit before it's surfaced to admins as stuck. */
const STALE_OUT_FOR_DELIVERY_HOURS = 24;
const STALE_IN_TRANSIT_HOURS = 72;
const STALE_PICKUP_RETRY_HOURS = 24;

/** Performance-report thresholds beyond which an agent is flagged for admin review (visibility only, no auto-suspend). */
const FLAG_RTO_RATE_PERCENT = 15;
const FLAG_FAILED_ATTEMPTS = 5;

export class DeliveryAgentsService {
  async create(input: CreateDeliveryAgentRequest, actorId: string) {
    const role = await Role.findOne({ where: { name: ROLES.DELIVERY_AGENT } });
    if (!role) throw new ValidationError({ role: ['Delivery agent role is not seeded'] });
    const existing = await User.findOne({ where: { email: input.email }, paranoid: false });
    if (existing) throw new ValidationError({ email: ['Email already registered'] });
    const passwordHash = await bcrypt.hash(input.password, 12);

    const agentId = await sequelize.transaction(async (transaction) => {
      const user = await User.create(
        {
          email: input.email,
          passwordHash,
          googleId: null,
          name: input.fullName,
          phone: input.phone,
          status: USER_STATUS.ACTIVE,
          roleId: role.id,
          vendorId: null,
          deliveryAgentId: null,
          emailVerified: true,
          emailMarketingConsent: false,
          emailSuppressed: false,
          avatarUrl: null,
          createdBy: actorId,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction },
      );
      const agent = await repo.create(
        {
          userId: user.id,
          fullName: input.fullName,
          phone: input.phone,
          vehicleType: input.vehicleType,
          hubOrZone: input.hubOrZone,
          status: 'ACTIVE',
          availableForAssignment: true,
          createdBy: actorId,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction },
      );
      await user.update({ deliveryAgentId: agent.id }, { transaction });
      await logAudit({
        actorId,
        action: 'DELIVERY_AGENT_CREATED',
        entityType: 'DeliveryAgent',
        entityId: agent.id,
        metadata: { hubOrZone: agent.hubOrZone, vehicleType: agent.vehicleType },
        transaction,
      });
      return agent.id;
    });
    clearPermissionCache();
    return repo.findById(agentId);
  }

  /** One bad row (duplicate email, etc.) must not sink the whole CSV batch — collect per-row outcomes instead. */
  async bulkCreate(
    rows: CreateDeliveryAgentRequest[],
    actorId: string,
  ): Promise<Array<{ row: number; email: string; success: boolean; error: string | null }>> {
    const results: Array<{ row: number; email: string; success: boolean; error: string | null }> = [];
    for (const [i, row] of rows.entries()) {
      try {
        await this.create(row, actorId);
        results.push({ row: i + 1, email: row.email, success: true, error: null });
      } catch (error) {
        results.push({
          row: i + 1,
          email: row.email,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return results;
  }

  async update(id: string, input: UpdateDeliveryAgentRequest, actorId: string) {
    const agent = await repo.findById(id);
    if (!agent) throw new NotFoundError('DeliveryAgent');
    await sequelize.transaction(async (transaction) => {
      await agent.update({ ...input, updatedBy: actorId }, { transaction });
      const userPatch: Record<string, unknown> = { updatedBy: actorId };
      if (input.fullName) userPatch.name = input.fullName;
      if (input.phone) userPatch.phone = input.phone;
      if (input.status) {
        userPatch.status = input.status === 'SUSPENDED' ? USER_STATUS.BLOCKED : USER_STATUS.ACTIVE;
      }
      await User.update(userPatch, { where: { id: agent.userId }, transaction });
      await logAudit({
        actorId,
        action: 'DELIVERY_AGENT_UPDATED',
        entityType: 'DeliveryAgent',
        entityId: agent.id,
        metadata: input,
        transaction,
      });
    });
    return repo.findById(id);
  }

  async list(filters: ListDeliveryAgentsRequest) {
    const { rows, count } = await repo.list(filters);
    const agents = await Promise.all(rows.map(async (agent) => {
      const [activeDeliveries, activePickups] = await repo.activeCounts(agent.id);
      const { average, count: ratingCount } = await deliveryRatingsService.averageForAgent(agent.id);
      return {
        ...agent.get({ plain: true }),
        activeDeliveries,
        activePickups,
        averageRating: average,
        ratingCount,
      };
    }));
    return { agents, pagination: buildPaginationMeta(count, filters.page, filters.limit) };
  }

  /**
   * Per-agent delivery performance for admin ops: delivered/RTO counts and
   * rate, failed-attempt rate (from the ShipmentAttempt ledger), average
   * fulfillment time (pickup → delivered — Shipment has no separate
   * "entered OUT_FOR_DELIVERY" timestamp to measure from), and average
   * customer rating (lifetime, not window-scoped, matching the agents list).
   */
  async performanceReport(range: { from: Date; to: Date }): Promise<
    Array<{
      deliveryAgentId: string;
      fullName: string;
      hubOrZone: string;
      delivered: number;
      rto: number;
      rtoRatePercent: number;
      failedAttempts: number;
      avgFulfillmentHours: number | null;
      averageRating: number | null;
      ratingCount: number;
      flagged: boolean;
      flagReason: string | null;
    }>
  > {
    const [agents, shipmentRows, attemptRows, ratingRows] = await Promise.all([
      repo.list({ page: 1, limit: 1000 }).then((result) => result.rows),
      sequelize.query<{
        deliveryAgentId: string;
        delivered: string;
        rto: string;
        avgFulfillmentSeconds: string | null;
      }>(
        `SELECT "deliveryAgentId",
           COUNT(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
           COUNT(*) FILTER (WHERE status IN ('RTO_INITIATED', 'RTO_DELIVERED')) AS rto,
           AVG(EXTRACT(EPOCH FROM ("deliveredAt" - "shippedAt")))
             FILTER (WHERE status = 'DELIVERED' AND "shippedAt" IS NOT NULL) AS "avgFulfillmentSeconds"
         FROM shipments
         WHERE "deliveryAgentId" IS NOT NULL AND "updatedAt" BETWEEN :from AND :to
         GROUP BY "deliveryAgentId"`,
        { replacements: { from: range.from, to: range.to }, type: QueryTypes.SELECT },
      ),
      sequelize.query<{ deliveryAgentId: string; failedAttempts: string }>(
        `SELECT s."deliveryAgentId" AS "deliveryAgentId", COUNT(sa.id) AS "failedAttempts"
         FROM shipment_attempts sa
         JOIN shipments s ON s.id = sa."shipmentId"
         WHERE sa."attemptedAt" BETWEEN :from AND :to AND s."deliveryAgentId" IS NOT NULL
         GROUP BY s."deliveryAgentId"`,
        { replacements: { from: range.from, to: range.to }, type: QueryTypes.SELECT },
      ),
      sequelize.query<{ deliveryAgentId: string; avgRating: string | null; ratingCount: string }>(
        `SELECT "deliveryAgentId", AVG(rating) AS "avgRating", COUNT(*) AS "ratingCount"
         FROM delivery_ratings
         GROUP BY "deliveryAgentId"`,
        { type: QueryTypes.SELECT },
      ),
    ]);

    const shipmentByAgent = new Map(shipmentRows.map((row) => [row.deliveryAgentId, row]));
    const attemptsByAgent = new Map(attemptRows.map((row) => [row.deliveryAgentId, row]));
    const ratingByAgent = new Map(ratingRows.map((row) => [row.deliveryAgentId, row]));

    return agents.map((agent) => {
      const shipmentRow = shipmentByAgent.get(agent.id);
      const delivered = Number(shipmentRow?.delivered ?? 0);
      const rto = Number(shipmentRow?.rto ?? 0);
      const failedAttempts = Number(attemptsByAgent.get(agent.id)?.failedAttempts ?? 0);
      const totalOutcomes = delivered + rto;
      const avgFulfillmentSeconds = shipmentRow?.avgFulfillmentSeconds
        ? Number(shipmentRow.avgFulfillmentSeconds)
        : null;
      const ratingRow = ratingByAgent.get(agent.id);
      const rtoRatePercent = totalOutcomes > 0 ? Math.round((rto / totalOutcomes) * 1000) / 10 : 0;

      const flagReasons: string[] = [];
      if (rtoRatePercent > FLAG_RTO_RATE_PERCENT) {
        flagReasons.push(`RTO rate ${rtoRatePercent}% exceeds ${FLAG_RTO_RATE_PERCENT}%`);
      }
      if (failedAttempts >= FLAG_FAILED_ATTEMPTS) {
        flagReasons.push(`${failedAttempts} failed attempts (threshold ${FLAG_FAILED_ATTEMPTS})`);
      }

      return {
        deliveryAgentId: agent.id,
        fullName: agent.fullName,
        hubOrZone: agent.hubOrZone,
        delivered,
        rto,
        rtoRatePercent,
        failedAttempts,
        avgFulfillmentHours: avgFulfillmentSeconds != null ? Math.round((avgFulfillmentSeconds / 3600) * 10) / 10 : null,
        averageRating: ratingRow?.avgRating != null ? Math.round(Number(ratingRow.avgRating) * 10) / 10 : null,
        ratingCount: Number(ratingRow?.ratingCount ?? 0),
        flagged: flagReasons.length > 0,
        flagReason: flagReasons.length > 0 ? flagReasons.join('; ') : null,
      };
    });
  }

  /** Shipments/pickups stuck mid-transit past a reasonable window — admin visibility, no auto-action. */
  async staleTasks(): Promise<{
    shipments: Array<{
      id: string;
      trackingNumber: string;
      status: string;
      updatedAt: Date;
      deliveryAgent: { id: string; fullName: string } | null;
    }>;
    pickups: Array<{
      id: string;
      status: string;
      updatedAt: Date;
      pickupFailureReason: string | null;
      deliveryAgent: { id: string; fullName: string } | null;
    }>;
  }> {
    const now = Date.now();
    const outForDeliveryCutoff = new Date(now - STALE_OUT_FOR_DELIVERY_HOURS * 60 * 60 * 1000);
    const inTransitCutoff = new Date(now - STALE_IN_TRANSIT_HOURS * 60 * 60 * 1000);
    const pickupCutoff = new Date(now - STALE_PICKUP_RETRY_HOURS * 60 * 60 * 1000);

    const shipments = await Shipment.findAll({
      where: {
        deliveryAgentId: { [Op.ne]: null },
        [Op.or]: [
          { status: 'OUT_FOR_DELIVERY', updatedAt: { [Op.lt]: outForDeliveryCutoff } },
          { status: 'IN_TRANSIT', updatedAt: { [Op.lt]: inTransitCutoff } },
        ],
      },
      include: [{ model: DeliveryAgent, as: 'deliveryAgent', attributes: ['id', 'fullName'] }],
      order: [['updatedAt', 'ASC']] as [string, string][],
      limit: 100,
    });

    const pickups = await ReturnRequest.findAll({
      where: {
        deliveryAgentId: { [Op.ne]: null },
        status: 'PICKUP_SCHEDULED',
        pickupFailureReason: { [Op.ne]: null },
        updatedAt: { [Op.lt]: pickupCutoff },
      },
      include: [{ model: DeliveryAgent, as: 'deliveryAgent', attributes: ['id', 'fullName'] }],
      order: [['updatedAt', 'ASC']] as [string, string][],
      limit: 100,
    });

    return {
      shipments: shipments.map((shipment) => {
        const plain = shipment.get({ plain: true }) as any;
        return {
          id: plain.id,
          trackingNumber: plain.trackingNumber,
          status: plain.status,
          updatedAt: plain.updatedAt,
          deliveryAgent: plain.deliveryAgent ?? null,
        };
      }),
      pickups: pickups.map((pickup) => {
        const plain = pickup.get({ plain: true }) as any;
        return {
          id: plain.id,
          status: plain.status,
          updatedAt: plain.updatedAt,
          pickupFailureReason: plain.pickupFailureReason,
          deliveryAgent: plain.deliveryAgent ?? null,
        };
      }),
    };
  }

  /** Feeds the admin dispatch picker — no more hunting for a shipment UUID elsewhere. */
  async unassignedShipments(): Promise<Array<{
    id: string;
    trackingNumber: string;
    status: string;
    createdAt: Date;
    orderId: string | null;
    vendorName: string | null;
    pincode: string | null;
  }>> {
    const shipments = await repo.unassignedShipments();
    return shipments.map((shipment) => {
      const plain = shipment.get({ plain: true }) as Record<string, unknown> & {
        subOrder?: {
          order?: { id: string; shippingAddress?: { pincode: string } };
          vendor?: { businessName: string };
        };
      };
      return {
        id: String(plain.id),
        trackingNumber: String(plain.trackingNumber),
        status: String(plain.status),
        createdAt: plain.createdAt as Date,
        orderId: plain.subOrder?.order?.id ?? null,
        vendorName: plain.subOrder?.vendor?.businessName ?? null,
        pincode: plain.subOrder?.order?.shippingAddress?.pincode ?? null,
      };
    });
  }

  /** Feeds the admin dispatch picker for return pickups — mirrors unassignedShipments. */
  async unassignedPickups(): Promise<Array<{
    id: string;
    type: string;
    status: string;
    updatedAt: Date;
    orderId: string | null;
    productName: string | null;
    customerName: string | null;
    pincode: string | null;
  }>> {
    const pickups = await repo.unassignedPickups();
    return pickups.map((pickup) => {
      const plain = pickup.get({ plain: true }) as Record<string, unknown> & {
        subOrder?: {
          orderId?: string;
          order?: { id: string; shippingAddress?: { pincode: string } };
        };
        orderItem?: { productName?: string };
        user?: { name?: string };
      };
      return {
        id: String(plain.id),
        type: String(plain.type),
        status: String(plain.status),
        updatedAt: plain.updatedAt as Date,
        orderId: plain.subOrder?.orderId ?? plain.subOrder?.order?.id ?? null,
        productName: plain.orderItem?.productName ?? null,
        customerName: plain.user?.name ?? null,
        pincode: plain.subOrder?.order?.shippingAddress?.pincode ?? null,
      };
    });
  }

  async bulkAssignShipments(input: BulkAssignShipmentsRequest, actorId: string) {
    const agent = await repo.findById(input.deliveryAgentId);
    if (!agent) throw new NotFoundError('DeliveryAgent');
    if (agent.status !== 'ACTIVE' || !agent.availableForAssignment) {
      throw new ValidationError({ deliveryAgentId: ['Agent is not available for assignment'] });
    }
    const shipments = await repo.findShipmentsByIds(input.shipmentIds);
    const found = new Set(shipments.map((s) => s.id));
    const missing = input.shipmentIds.filter((id) => !found.has(id));
    if (missing.length) throw new NotFoundError('Shipment');
    const undeliverable = shipments.filter((s) => s.status === 'DELIVERED');
    if (undeliverable.length) {
      throw new ValidationError({ shipmentIds: ['Delivered shipments cannot be reassigned'] });
    }

    const assignedAt = new Date();
    await sequelize.transaction((transaction) =>
      Promise.all(
        shipments.map((shipment) =>
          shipment.update(
            { deliveryAgentId: input.deliveryAgentId, assignedAt, updatedBy: actorId },
            { transaction },
          ),
        ),
      ),
    );
    await logAudit({
      actorId,
      action: 'SHIPMENT_BULK_AGENT_ASSIGNED',
      entityType: 'Shipment',
      entityId: input.deliveryAgentId,
      metadata: { shipmentIds: input.shipmentIds, count: shipments.length },
    });
    void notificationsService.sendDeliveryAssigned(
      agent.userId,
      `bulk:${input.deliveryAgentId}:${assignedAt.toISOString()}`,
      { trackingNumber: `${shipments.length} shipments` },
    );
    return { assigned: shipments.length };
  }

  async taskCounts(id: string) {
    const agent = await repo.findById(id);
    if (!agent) throw new NotFoundError('DeliveryAgent');
    const [activeDeliveries, activePickups] = await repo.activeCounts(id);
    return { activeDeliveries, activePickups };
  }

  async profile(id: string) {
    const agent = await repo.findById(id);
    if (!agent) throw new NotFoundError('DeliveryAgent');
    const { average, count: ratingCount } = await deliveryRatingsService.averageForAgent(id);
    return { ...agent.get({ plain: true }), averageRating: average, ratingCount };
  }

  async myRatings(deliveryAgentId: string) {
    const [stats, recentRatings] = await Promise.all([
      deliveryRatingsService.averageForAgent(deliveryAgentId),
      DeliveryRating.findAll({
        where: { deliveryAgentId },
        attributes: ['id', 'rating', 'comment', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: 50,
      }),
    ]);
    return {
      averageRating: stats.average,
      ratingCount: stats.count,
      ratings: recentRatings,
    };
  }

  async setAvailability(id: string, availableForAssignment: boolean) {
    const agent = await repo.findById(id);
    if (!agent) throw new NotFoundError('DeliveryAgent');
    if (agent.status !== 'ACTIVE' && availableForAssignment) {
      throw new ValidationError({ availableForAssignment: ['Only active agents can accept assignments'] });
    }
    if (availableForAssignment) {
      await this.assertDocumentsVerified(id);
    }
    return agent.update({ availableForAssignment });
  }

  private async assertDocumentsVerified(deliveryAgentId: string) {
    const documents = await repo.documentsForAgent(deliveryAgentId);
    const today = new Date().toISOString().slice(0, 10);
    const isLiveAndVerified = (doc: DeliveryAgentDocument) =>
      doc.verified && (!doc.expiryDate || doc.expiryDate >= today);
    const missing = DELIVERY_AGENT_REQUIRED_DOCUMENT_TYPES.filter(
      (type) => !documents.some((doc) => doc.type === type && isLiveAndVerified(doc)),
    );
    if (missing.length > 0) {
      throw new ValidationError({
        availableForAssignment: [
          `Verification documents required before going on duty: ${missing.join(', ')}`,
        ],
      });
    }
  }

  async submitDocument(deliveryAgentId: string, input: SubmitDocumentRequest) {
    return repo.createDocument({
      deliveryAgentId,
      type: input.type,
      url: input.url,
      expiryDate: input.expiryDate ?? null,
      createdBy: deliveryAgentId,
    });
  }

  myDocuments(deliveryAgentId: string) {
    return repo.documentsForAgent(deliveryAgentId);
  }

  adminListDocuments() {
    return repo.listAllDocuments();
  }

  async reviewDocument(documentId: string, actorId: string, input: ReviewDocumentRequest) {
    const document = await repo.findDocumentById(documentId);
    if (!document) throw new NotFoundError('DeliveryAgentDocument');
    if (input.action === 'APPROVE') {
      await document.update({
        verified: true,
        verifiedById: actorId,
        rejectionReason: null,
        rejectedAt: null,
        updatedBy: actorId,
      });
    } else {
      await document.update({
        verified: false,
        verifiedById: actorId,
        rejectionReason: input.rejectionReason ?? null,
        rejectedAt: new Date(),
        updatedBy: actorId,
      });
    }
    await logAudit({
      actorId,
      action: input.action === 'APPROVE' ? 'AGENT_DOCUMENT_APPROVED' : 'AGENT_DOCUMENT_REJECTED',
      entityType: 'DeliveryAgentDocument',
      entityId: document.id,
      metadata: { deliveryAgentId: document.deliveryAgentId, type: document.type },
    });
    return document;
  }

  async assignShipment(shipmentId: string, deliveryAgentId: string, actorId: string) {
    const [shipment, agent] = await Promise.all([
      Shipment.findByPk(shipmentId),
      repo.findById(deliveryAgentId),
    ]);
    if (!shipment) throw new NotFoundError('Shipment');
    if (!agent) throw new NotFoundError('DeliveryAgent');
    if (agent.status !== 'ACTIVE' || !agent.availableForAssignment) {
      throw new ValidationError({ deliveryAgentId: ['Agent is not available for assignment'] });
    }
    if (shipment.status === 'DELIVERED') {
      throw new ValidationError({ shipmentId: ['Delivered shipments cannot be reassigned'] });
    }
    await shipment.update({ deliveryAgentId, assignedAt: new Date(), updatedBy: actorId });
    await logAudit({
      actorId,
      action: 'SHIPMENT_AGENT_ASSIGNED',
      entityType: 'Shipment',
      entityId: shipment.id,
      metadata: { deliveryAgentId },
    });
    void notificationsService.sendDeliveryAssigned(agent.userId, `${shipment.id}:${agent.id}`, {
      trackingNumber: shipment.trackingNumber,
    });
    return shipment;
  }

  async assignPickup(returnId: string, deliveryAgentId: string, actorId: string) {
    const [pickup, agent] = await Promise.all([
      ReturnRequest.findByPk(returnId),
      repo.findById(deliveryAgentId),
    ]);
    if (!pickup) throw new NotFoundError('ReturnRequest');
    if (!agent) throw new NotFoundError('DeliveryAgent');
    if (pickup.status !== RETURN_STATUS.PICKUP_SCHEDULED) {
      throw new ValidationError({ returnId: ['Return must be scheduled for pickup'] });
    }
    if (agent.status !== 'ACTIVE' || !agent.availableForAssignment) {
      throw new ValidationError({ deliveryAgentId: ['Agent is not available for assignment'] });
    }
    await pickup.update({ deliveryAgentId, pickupFailureReason: null, updatedBy: actorId });
    void notificationsService.sendPickupAssigned(agent.userId, `${pickup.id}:${agent.id}`);
    await logAudit({
      actorId,
      action: 'RETURN_PICKUP_AGENT_ASSIGNED',
      entityType: 'ReturnRequest',
      entityId: pickup.id,
      metadata: { deliveryAgentId },
    });
    return pickup;
  }

  deliveries(deliveryAgentId: string, statuses?: string[]) {
    return repo.myDeliveries(deliveryAgentId, statuses);
  }

  async delivery(shipmentId: string, deliveryAgentId: string) {
    const shipment = await repo.shipmentById(shipmentId, deliveryAgentId);
    if (!shipment) throw new NotFoundError('AssignedShipment');
    return shipment;
  }

  async updateLocation(deliveryAgentId: string, lat: number, lng: number) {
    const agent = await repo.findById(deliveryAgentId);
    if (!agent) throw new NotFoundError('DeliveryAgent');
    await agent.update({ lastLat: lat, lastLng: lng, locationUpdatedAt: new Date() });

    const activeShipments = await Shipment.findAll({
      where: { deliveryAgentId, status: 'OUT_FOR_DELIVERY' },
      attributes: ['id'],
    });
    const updatedAt = (agent.locationUpdatedAt as Date).toISOString();
    for (const shipment of activeShipments) {
      emitShipmentLocation(shipment.id, { lat, lng, updatedAt });
    }

    return { lat, lng, updatedAt };
  }

  /** Daily shift card: completed counts + COD cash the agent is holding for hub deposit. */
  async shiftSummary(deliveryAgentId: string) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const [deliveredToday, pickupsToday, codCollectedAllTime, depositedOrPending, settings] =
      await Promise.all([
        Shipment.count({
          where: { deliveryAgentId, status: 'DELIVERED', deliveredAt: { [Op.gte]: dayStart } },
        }),
        ReturnRequest.count({
          where: { deliveryAgentId, status: RETURN_STATUS.RECEIVED, receivedAt: { [Op.gte]: dayStart } },
        }),
        Shipment.findAll({
          where: { deliveryAgentId, status: 'DELIVERED', codCollected: true },
          attributes: ['codAmount'],
        }),
        DeliveryCashDeposit.findAll({
          where: { deliveryAgentId, status: { [Op.in]: ['PENDING', 'VERIFIED'] } },
          attributes: ['amount'],
        }),
        settingsService.getPlatformSettings(),
      ]);
    const attemptedToday = await Shipment.count({
      where: {
        deliveryAgentId,
        [Op.or]: [
          { deliveredAt: { [Op.gte]: dayStart } },
          { lastFailedAttemptAt: { [Op.gte]: dayStart } },
        ],
      },
    });
    const totalCodCollectedPaise = toPaise(sumRupees(codCollectedAllTime.map((s) => s.codAmount)));
    const totalDepositedPaise = toPaise(sumRupees(depositedOrPending.map((d) => d.amount)));
    const codCashInHand = fromPaise(Math.max(0, totalCodCollectedPaise - totalDepositedPaise));
    const onTimePercent = attemptedToday > 0 ? Math.round((deliveredToday / attemptedToday) * 100) : 0;
    const perTaskEarning = Number(settings.deliveryAgentPerTaskEarning ?? 0);
    const [earningsTodayRows, pendingEarningsRows, pendingDeposits] = await Promise.all([
      DeliveryAgentEarning.findAll({
        where: { deliveryAgentId, earnedAt: { [Op.gte]: dayStart } },
        attributes: ['amount'],
      }),
      DeliveryAgentEarning.findAll({
        where: { deliveryAgentId, status: 'PENDING' },
        attributes: ['amount'],
      }),
      DeliveryCashDeposit.count({ where: { deliveryAgentId, status: 'PENDING' } }),
    ]);
    const earningsToday = sumRupees(earningsTodayRows.map((r) => r.amount));
    const pendingEarnings = sumRupees(pendingEarningsRows.map((r) => r.amount));
    const pendingEarningsCount = pendingEarningsRows.length;

    return {
      deliveredToday,
      pickupsToday,
      onTimePercent,
      codCashInHand,
      pendingEarnings,
      pendingEarningsCount,
      earningsToday,
      perTaskEarning,
      pendingDeposits,
    };
  }

  async closeCashShift(deliveryAgentId: string, amount: number, note: string | undefined, actorId: string) {
    const summary = await this.shiftSummary(deliveryAgentId);
    const deposit = await repo.createCashDeposit({
      deliveryAgentId,
      amount,
      expectedAmount: summary.codCashInHand,
      note: note ?? null,
      createdBy: actorId,
    });
    await logAudit({
      actorId,
      action: 'CASH_DEPOSIT_SUBMITTED',
      entityType: 'DeliveryCashDeposit',
      entityId: deposit.id,
      metadata: { amount, expectedAmount: summary.codCashInHand },
    });
    return deposit;
  }

  myCashDeposits(deliveryAgentId: string) {
    return repo.cashDepositsForAgent(deliveryAgentId);
  }

  adminListCashDeposits(status?: string) {
    return repo.listCashDeposits(status);
  }

  async verifyCashDeposit(
    depositId: string,
    actorId: string,
    action: 'VERIFY' | 'REJECT',
    rejectionReason?: string,
  ) {
    const deposit = await repo.findCashDepositById(depositId);
    if (!deposit) throw new NotFoundError('DeliveryCashDeposit');
    if (deposit.status !== 'PENDING') {
      throw new ValidationError({ status: ['This deposit has already been reviewed'] });
    }
    await deposit.update({
      status: action === 'VERIFY' ? 'VERIFIED' : 'REJECTED',
      rejectionReason: action === 'REJECT' ? (rejectionReason ?? null) : null,
      verifiedById: actorId,
      verifiedAt: new Date(),
      updatedBy: actorId,
    });
    await logAudit({
      actorId,
      action: action === 'VERIFY' ? 'CASH_DEPOSIT_VERIFIED' : 'CASH_DEPOSIT_REJECTED',
      entityType: 'DeliveryCashDeposit',
      entityId: deposit.id,
      metadata: { rejectionReason },
    });
    const agent = await repo.findById(deposit.deliveryAgentId);
    if (agent) {
      const amount = roundMoney(deposit.amount);
      if (action === 'VERIFY') {
        void notificationsService.sendCashDepositVerified(agent.userId, deposit.id, { amount });
      } else {
        void notificationsService.sendCashDepositRejected(agent.userId, deposit.id, {
          amount,
          reason: rejectionReason ?? 'Not specified',
        });
      }
    }
    return deposit;
  }

  /** Admin/hub visibility into shipments currently mid-RTO or handed back. */
  async adminRtoQueue() {
    return repo.rtoShipments();
  }

  async requestRtoHandoverCode(shipmentId: string, deliveryAgentId: string) {
    const shipment = await repo.assignedShipment(shipmentId, deliveryAgentId);
    if (!shipment) throw new NotFoundError('AssignedShipment');
    if (shipment.status !== 'RTO_INITIATED') {
      throw new ValidationError({ status: ['Shipment is not awaiting RTO handover'] });
    }
    const vendorId = (shipment as Shipment & { subOrder?: SubOrder }).subOrder?.vendorId;
    if (!vendorId) throw new ValidationError({ shipmentId: ['Shipment has no linked vendor'] });
    const vendorUser = await User.findOne({ where: { vendorId }, attributes: ['id'] });
    if (!vendorUser) throw new ValidationError({ shipmentId: ['Vendor has no linked account'] });

    const otp = await otpService.issueCodeForUser(vendorUser.id, 'RTO_HANDOVER_CONFIRMATION');
    await notificationsService.sendRtoHandoverOtp(vendorUser.id, otp.id, {
      code: otp.code,
      expiresInMinutes: OTP_TTL_MINUTES,
      trackingNumber: shipment.trackingNumber,
    });
    return { sent: true, expiresInMinutes: OTP_TTL_MINUTES };
  }

  async confirmRtoHandover(shipmentId: string, deliveryAgentId: string, actorId: string, otpCode: string) {
    const result = await sequelize.transaction(async (transaction) => {
      const shipment = await repo.assignedShipment(shipmentId, deliveryAgentId, transaction);
      if (!shipment) throw new NotFoundError('AssignedShipment');
      if (shipment.status !== 'RTO_INITIATED') {
        throw new ValidationError({ status: ['Shipment is not awaiting RTO handover'] });
      }
      const vendorId = (shipment as Shipment & { subOrder?: SubOrder }).subOrder?.vendorId;
      if (!vendorId) throw new ValidationError({ shipmentId: ['Shipment has no linked vendor'] });
      const vendorUser = await User.findOne({ where: { vendorId }, attributes: ['id'], transaction });
      if (!vendorUser) throw new ValidationError({ shipmentId: ['Vendor has no linked account'] });

      const verification = await otpService.verifyCodeForUser(
        vendorUser.id,
        'RTO_HANDOVER_CONFIRMATION',
        otpCode,
        transaction,
      );
      if (!verification.valid) return { shipment: null, verification };

      await shippingService.applyShipmentStatus(
        shipment,
        'RTO_DELIVERED',
        { rtoHandoverOtpVerifiedAt: new Date(), rtoConfirmedAt: new Date(), updatedBy: actorId },
        transaction,
      );
      await logAudit({
        actorId,
        action: 'RTO_HANDOVER_CONFIRMED',
        entityType: 'Shipment',
        entityId: shipment.id,
        metadata: { vendorId },
        transaction,
      });
      return { shipment, verification, vendorUserId: vendorUser.id };
    });
    if (!result.verification.valid) {
      throw new ValidationError({ otpCode: [result.verification.message] });
    }
    if (result.shipment) {
      void notificationsService.sendRtoHandoverConfirmed(result.vendorUserId, result.shipment.id, {
        trackingNumber: result.shipment.trackingNumber,
      });
    }
    return result.shipment;
  }

  async requestDeliveryCode(shipmentId: string, deliveryAgentId: string) {
    const shipment = await repo.assignedShipment(shipmentId, deliveryAgentId);
    if (!shipment) throw new NotFoundError('AssignedShipment');
    if (shipment.status !== 'OUT_FOR_DELIVERY') {
      throw new ValidationError({ status: ['Delivery must be out for delivery'] });
    }
    const customerId = customerIdFromShipment(shipment);
    if (!customerId) {
      throw new ValidationError({ shipmentId: ['Shipment has no linked customer'] });
    }
    const otp = await otpService.issueCodeForUser(customerId, 'DELIVERY_CONFIRMATION');
    await notificationsService.sendDeliveryOtp(customerId, otp.id, {
      code: otp.code,
      expiresInMinutes: OTP_TTL_MINUTES,
      trackingNumber: shipment.trackingNumber,
    });
    return { sent: true, expiresInMinutes: OTP_TTL_MINUTES };
  }

  async updateDeliveryStatus(
    shipmentId: string,
    deliveryAgentId: string,
    actorId: string,
    input: {
      status: 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'FAILED' | 'RTO_DELIVERED';
      note?: string;
      photoUrl?: string;
    },
  ) {
    const updated = await sequelize.transaction(async (transaction) => {
      const shipment = await repo.assignedShipment(shipmentId, deliveryAgentId, transaction);
      if (!shipment) throw new NotFoundError('AssignedShipment');
      assertDeliveryTransition(shipment.status, input.status);
      const extra: Record<string, unknown> = { updatedBy: actorId };
      if (input.status === 'FAILED') extra.failureReason = input.note;
      // Locked within this transaction so two concurrent status updates for the
      // same shipment (e.g. duplicate retries) can't both read the same stale
      // failedAttemptCount and undercount it, delaying the RTO auto-transition.
      return shippingService.applyShipmentStatus(shipment, input.status, extra, transaction);
    });

    if (input.status === 'OUT_FOR_DELIVERY') {
      await this.requestDeliveryCode(updated.id, deliveryAgentId);
    }
    if (input.status === 'FAILED') {
      await ShipmentAttempt.create({
        shipmentId: updated.id,
        attemptNumber: updated.failedAttemptCount,
        note: input.note ?? '',
        photoUrl: input.photoUrl ?? null,
        attemptedAt: new Date(),
        createdBy: actorId,
      });
      await logAudit({
        actorId,
        action: updated.status === 'RTO_INITIATED' ? 'DELIVERY_RTO_INITIATED' : 'DELIVERY_ATTEMPT_FAILED',
        entityType: 'Shipment',
        entityId: updated.id,
        metadata: { note: input.note, failedAttemptCount: updated.failedAttemptCount },
      });
    }
    return updated;
  }

  async confirmDelivery(
    shipmentId: string,
    deliveryAgentId: string,
    actorId: string,
    input: { otpCode: string; proofPhotoUrl?: string; codCollected?: boolean },
  ) {
    const result = await sequelize.transaction(async (transaction) => {
      const shipment = await repo.assignedShipment(shipmentId, deliveryAgentId, transaction);
      if (!shipment) throw new NotFoundError('AssignedShipment');
      if (shipment.status !== 'OUT_FOR_DELIVERY') {
        throw new ValidationError({ status: ['Delivery must be out for delivery before confirmation'] });
      }
      const isCod = shipment.codAmount != null;
      if (isCod && !input.codCollected) {
        throw new ValidationError({ codCollected: ['Cash on delivery amount must be collected before confirming'] });
      }
      const customerId = customerIdFromShipment(shipment);
      if (!customerId) throw new ValidationError({ shipmentId: ['Shipment has no linked customer'] });
      const verification = await otpService.verifyCodeForUser(
        customerId,
        'DELIVERY_CONFIRMATION',
        input.otpCode,
        transaction,
      );
      if (!verification.valid) {
        return { shipment: null, verification };
      }
      await shippingService.applyShipmentStatus(
        shipment,
        'DELIVERED',
        {
          deliveryOtpVerifiedAt: new Date(),
          proofOfDeliveryUrl: input.proofPhotoUrl ?? shipment.proofOfDeliveryUrl,
          ...(isCod ? { codCollected: true, codCollectedAt: new Date() } : {}),
          updatedBy: actorId,
        },
        transaction,
      );
      await logAudit({
        actorId,
        action: 'DELIVERY_CONFIRMED',
        entityType: 'Shipment',
        entityId: shipment.id,
        metadata: { otpVerified: true, proofProvided: Boolean(input.proofPhotoUrl), codCollected: isCod },
        transaction,
      });
      return { shipment, verification };
    });
    if (!result.verification.valid) {
      throw new ValidationError({ otpCode: [result.verification.message] });
    }
    return result.shipment;
  }

  async forceConfirmDelivery(shipmentId: string, actorId: string, reason: string) {
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment) throw new NotFoundError('Shipment');
    if (shipment.status === 'DELIVERED') return shipment;
    if (shipment.status !== 'OUT_FOR_DELIVERY') {
      throw new ValidationError({ status: ['Only an out-for-delivery shipment can be force confirmed'] });
    }
    const updated = await shippingService.applyShipmentStatus(shipment, 'DELIVERED', { updatedBy: actorId });
    await logAudit({
      actorId,
      action: 'DELIVERY_FORCE_CONFIRMED',
      entityType: 'Shipment',
      entityId: shipment.id,
      metadata: { reason },
    });
    return updated;
  }

  pickups(deliveryAgentId: string, statuses?: string[]) {
    return repo.myPickups(deliveryAgentId, statuses);
  }

  async pickup(returnId: string, deliveryAgentId: string) {
    const pickup = await repo.pickupById(returnId, deliveryAgentId);
    if (!pickup) throw new NotFoundError('AssignedReturnPickup');
    return pickup;
  }

  async requestPickupCode(returnId: string, deliveryAgentId: string) {
    const pickup = await repo.assignedPickup(returnId, deliveryAgentId);
    if (!pickup) throw new NotFoundError('AssignedReturnPickup');
    if (pickup.status !== RETURN_STATUS.PICKUP_SCHEDULED) {
      throw new ValidationError({ status: ['Return is not scheduled for pickup'] });
    }
    const otp = await otpService.issueCodeForUser(pickup.userId, 'RETURN_PICKUP_CONFIRMATION');
    await notificationsService.sendReturnPickupOtp(pickup.userId, otp.id, {
      code: otp.code,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
    return { sent: true, expiresInMinutes: OTP_TTL_MINUTES };
  }

  async updatePickupStatus(returnId: string, deliveryAgentId: string, actorId: string, note: string) {
    const pickup = await repo.assignedPickup(returnId, deliveryAgentId);
    if (!pickup) throw new NotFoundError('AssignedReturnPickup');
    if (pickup.status !== RETURN_STATUS.PICKUP_SCHEDULED) {
      throw new ValidationError({ status: ['Only a scheduled pickup can record a failed attempt'] });
    }

    const priorAttempts = await AuditLog.count({
      where: {
        entityType: 'ReturnRequest',
        entityId: pickup.id,
        action: 'RETURN_PICKUP_ATTEMPT_FAILED',
      },
    });
    const currentAttempt = priorAttempts + 1;
    const isMaxAttempts = currentAttempt >= 3;

    if (isMaxAttempts) {
      await pickup.update({
        status: RETURN_STATUS.CLOSED,
        pickupFailureReason: note,
        rejectionReason: 'Closed after 3 failed pickup attempts.',
        updatedBy: actorId,
      });
      await logAudit({
        actorId,
        action: 'RETURN_PICKUP_AUTO_CLOSED',
        entityType: 'ReturnRequest',
        entityId: pickup.id,
        metadata: { attempts: currentAttempt, note },
      });
    } else {
      await pickup.update({ pickupFailureReason: note, updatedBy: actorId });
    }

    await logAudit({
      actorId,
      action: 'RETURN_PICKUP_ATTEMPT_FAILED',
      entityType: 'ReturnRequest',
      entityId: pickup.id,
      metadata: { note, attemptNumber: currentAttempt },
    });

    void notificationsService.sendPickupAttemptFailed(pickup.userId, pickup.id, {
      reason: isMaxAttempts
        ? 'Exceeded maximum 3 failed pickup attempts. Return request has been closed.'
        : note,
    });
    return pickup;
  }

  async confirmPickup(
    returnId: string,
    deliveryAgentId: string,
    actorId: string,
    input: { otpCode: string; itemConditionPhotoUrls?: string[]; replacementProofUrl?: string },
  ) {
    const result = await sequelize.transaction(async (transaction) => {
      const row = await repo.assignedPickup(returnId, deliveryAgentId, transaction);
      if (!row) throw new NotFoundError('AssignedReturnPickup');
      if (row.status !== RETURN_STATUS.PICKUP_SCHEDULED) {
        throw new ValidationError({ status: ['Return is not scheduled for pickup'] });
      }
      if (row.type === RETURN_TYPE.EXCHANGE) {
        if (!input.itemConditionPhotoUrls?.length) {
          throw new ValidationError({ itemConditionPhotoUrls: ['Condition photos are required for an exchange'] });
        }
        if (!input.replacementProofUrl) {
          throw new ValidationError({ replacementProofUrl: ['Replacement handover proof is required'] });
        }
        const orderItem = (row as ReturnRequest & { orderItem?: { variantId: string } }).orderItem;
        if (!orderItem?.variantId) {
          throw new ValidationError({ orderItemId: ['Return has no replacement variant'] });
        }
        const variant = await ProductVariant.findByPk(orderItem.variantId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        const replacementQuantity = Number(row.returnQuantity ?? 1);
        if (!variant || Number(variant.stock) < replacementQuantity) {
          throw new ValidationError(ERROR_MESSAGES.INSUFFICIENT_STOCK);
        }
        await variant.update(
          { stock: Number(variant.stock) - replacementQuantity, updatedBy: actorId },
          { transaction },
        );
      }
      const verification = await otpService.verifyCodeForUser(
        row.userId,
        'RETURN_PICKUP_CONFIRMATION',
        input.otpCode,
        transaction,
      );
      if (!verification.valid) {
        return { pickup: null, verification };
      }
      await row.update(
        {
          status: RETURN_STATUS.RECEIVED,
          receivedAt: new Date(),
          pickupOtpVerifiedAt: new Date(),
          pickupFailureReason: null,
          photoUrls: input.itemConditionPhotoUrls?.length
            ? [...row.photoUrls, ...input.itemConditionPhotoUrls]
            : row.photoUrls,
          replacementDeliveredAt: row.type === RETURN_TYPE.EXCHANGE ? new Date() : null,
          replacementProofUrl: input.replacementProofUrl ?? null,
          updatedBy: actorId,
        },
        { transaction },
      );
      await deliveryAgentPayoutsService.recordEarning(deliveryAgentId, 'PICKUP', row.id, transaction);
      await logAudit({
        actorId,
        action: 'RETURN_PICKUP_CONFIRMED',
        entityType: 'ReturnRequest',
        entityId: row.id,
        metadata: { type: row.type, otpVerified: true },
        transaction,
      });
      return { pickup: row, verification };
    });

    if (!result.verification.valid) {
      throw new ValidationError({ otpCode: [result.verification.message] });
    }
    const pickup = result.pickup;
    if (!pickup) throw new NotFoundError('AssignedReturnPickup');

    const orderId = (pickup as any).subOrder?.orderId ?? (pickup as any).subOrder?.order?.id;
    void notificationsService.sendOrderReturned(pickup.userId, pickup.id, {
      orderId,
      orderNumber: orderId ? String(orderId).slice(0, 8).toUpperCase() : '',
      status: RETURN_STATUS.RECEIVED,
    });
    return pickup;
  }
}

export const deliveryAgentsService = new DeliveryAgentsService();
