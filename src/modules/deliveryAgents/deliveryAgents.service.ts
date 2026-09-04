import bcrypt from 'bcrypt';
import { Op, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { Shipment } from '@database/models/shipment.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { DeliveryCashDeposit } from '@database/models/deliveryCashDeposit.model';
import { DeliveryAgentEarning } from '@database/models/deliveryAgentEarning.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { NotFoundError, ValidationError } from '@core/errors';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PAYMENT_STATUS, RETURN_STATUS, RETURN_TYPE, ROLES, USER_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta } from '@core/http/pagination';
import { clearPermissionCache } from '@middleware/rbac.middleware';
import { logAudit } from '@modules/audit/audit.service';
import { shippingService } from '@modules/shipping/shipping.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { OTP_TTL_MINUTES, otpService } from '@modules/auth/otp.service';
import { settingsService } from '@modules/settings/settings.service';
import { roundMoney } from '@modules/pricing/money';
import { emitShipmentLocation } from '@realtime/socket';
import type {
  BulkAssignShipmentsRequest,
  CreateDeliveryAgentRequest,
  ListDeliveryAgentsRequest,
  UpdateDeliveryAgentRequest,
} from './deliveryAgents.dto';
import { deliveryAgentsRepository as repo } from './deliveryAgents.repository';
import { deliveryAgentPayoutsService } from './deliveryAgentPayouts.service';

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
      return {
        ...agent.get({ plain: true }),
        activeDeliveries,
        activePickups,
      };
    }));
    return { agents, pagination: buildPaginationMeta(count, filters.page, filters.limit) };
  }

  /** Feeds the admin dispatch picker — no more hunting for a shipment UUID elsewhere. */
  async unassignedShipments(): Promise<Array<{
    id: string;
    trackingNumber: string;
    status: string;
    createdAt: Date;
    orderId: string | null;
    vendorName: string | null;
  }>> {
    const shipments = await repo.unassignedShipments();
    return shipments.map((shipment) => {
      const plain = shipment.get({ plain: true }) as Record<string, unknown> & {
        subOrder?: { order?: { id: string }; vendor?: { businessName: string } };
      };
      return {
        id: String(plain.id),
        trackingNumber: String(plain.trackingNumber),
        status: String(plain.status),
        createdAt: plain.createdAt as Date,
        orderId: plain.subOrder?.order?.id ?? null,
        vendorName: plain.subOrder?.vendor?.businessName ?? null,
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
  }>> {
    const pickups = await repo.unassignedPickups();
    return pickups.map((pickup) => {
      const plain = pickup.get({ plain: true }) as Record<string, unknown> & {
        subOrder?: { orderId?: string; order?: { id: string } };
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
    await Promise.all(
      shipments.map((shipment) =>
        shipment.update({ deliveryAgentId: input.deliveryAgentId, assignedAt, updatedBy: actorId }),
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
    return agent;
  }

  async setAvailability(id: string, availableForAssignment: boolean) {
    const agent = await repo.findById(id);
    if (!agent) throw new NotFoundError('DeliveryAgent');
    if (agent.status !== 'ACTIVE' && availableForAssignment) {
      throw new ValidationError({ availableForAssignment: ['Only active agents can accept assignments'] });
    }
    return agent.update({ availableForAssignment });
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
    const totalCodCollected = codCollectedAllTime.reduce((sum, s) => sum + Number(s.codAmount ?? 0), 0);
    const totalDeposited = depositedOrPending.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    const codCashInHand = Math.max(0, Math.round((totalCodCollected - totalDeposited) * 100) / 100);
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
    const earningsToday = roundMoney(earningsTodayRows.reduce((sum, r) => sum + Number(r.amount), 0));
    const pendingEarnings = roundMoney(pendingEarningsRows.reduce((sum, r) => sum + Number(r.amount), 0));

    return {
      deliveredToday,
      pickupsToday,
      onTimePercent,
      codCashInHand,
      pendingEarnings,
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
      return { shipment, verification };
    });
    if (!result.verification.valid) {
      throw new ValidationError({ otpCode: [result.verification.message] });
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
    },
  ) {
    const shipment = await repo.assignedShipment(shipmentId, deliveryAgentId);
    if (!shipment) throw new NotFoundError('AssignedShipment');
    assertDeliveryTransition(shipment.status, input.status);
    const extra: Record<string, unknown> = { updatedBy: actorId };
    if (input.status === 'FAILED') extra.failureReason = input.note;
    const updated = await shippingService.applyShipmentStatus(shipment, input.status, extra);

    if (input.status === 'OUT_FOR_DELIVERY') {
      await this.requestDeliveryCode(shipment.id, deliveryAgentId);
    }
    if (input.status === 'FAILED') {
      await logAudit({
        actorId,
        action: updated.status === 'RTO_INITIATED' ? 'DELIVERY_RTO_INITIATED' : 'DELIVERY_ATTEMPT_FAILED',
        entityType: 'Shipment',
        entityId: shipment.id,
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
      if (isCod) {
        await this.settleCodPaymentIfComplete(shipment.subOrderId, transaction);
      }
      await deliveryAgentPayoutsService.recordEarning(deliveryAgentId, 'DELIVERY', shipment.id, transaction);
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

  /** Marks the order PAID once every COD shipment on it has had cash collected at the door. */
  private async settleCodPaymentIfComplete(subOrderId: string, transaction: Transaction) {
    const subOrder = await SubOrder.findByPk(subOrderId, { transaction });
    if (!subOrder) return;
    const order = await Order.findByPk(subOrder.orderId, { transaction });
    if (!order || order.paymentMethod !== 'COD' || order.paymentStatus === PAYMENT_STATUS.PAID) return;

    const siblingShipments = await Shipment.findAll({
      include: [{ association: 'subOrder', where: { orderId: order.id }, attributes: [] }],
      transaction,
    });
    const codShipments = siblingShipments.filter((s) => s.codAmount != null);
    const allCollected = codShipments.length > 0 && codShipments.every((s) => s.codCollected);
    if (allCollected) {
      await order.update({ paymentStatus: PAYMENT_STATUS.PAID }, { transaction });
    }
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
    await pickup.update({ pickupFailureReason: note, updatedBy: actorId });
    await logAudit({
      actorId,
      action: 'RETURN_PICKUP_ATTEMPT_FAILED',
      entityType: 'ReturnRequest',
      entityId: pickup.id,
      metadata: { note },
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
