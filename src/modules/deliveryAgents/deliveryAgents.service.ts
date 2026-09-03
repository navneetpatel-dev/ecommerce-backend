import bcrypt from 'bcrypt';
import { sequelize } from '@database/models';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { Shipment } from '@database/models/shipment.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { NotFoundError, ValidationError } from '@core/errors';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { RETURN_STATUS, RETURN_TYPE, ROLES, USER_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta } from '@core/http/pagination';
import { clearPermissionCache } from '@middleware/rbac.middleware';
import { logAudit } from '@modules/audit/audit.service';
import { shippingService } from '@modules/shipping/shipping.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { OTP_TTL_MINUTES, otpService } from '@modules/auth/otp.service';
import type {
  CreateDeliveryAgentRequest,
  ListDeliveryAgentsRequest,
  UpdateDeliveryAgentRequest,
} from './deliveryAgents.dto';
import { deliveryAgentsRepository as repo } from './deliveryAgents.repository';

const DELIVERY_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'FAILED'],
  OUT_FOR_DELIVERY: ['FAILED'],
  FAILED: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'],
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
    input: { status: 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'FAILED'; note?: string },
  ) {
    const shipment = await repo.assignedShipment(shipmentId, deliveryAgentId);
    if (!shipment) throw new NotFoundError('AssignedShipment');
    assertDeliveryTransition(shipment.status, input.status);
    const updated = await shippingService.applyShipmentStatus(shipment, input.status, { updatedBy: actorId });

    if (input.status === 'OUT_FOR_DELIVERY') {
      await this.requestDeliveryCode(shipment.id, deliveryAgentId);
    }
    if (input.status === 'FAILED') {
      await logAudit({
        actorId,
        action: 'DELIVERY_ATTEMPT_FAILED',
        entityType: 'Shipment',
        entityId: shipment.id,
        metadata: { note: input.note },
      });
    }
    return updated;
  }

  async confirmDelivery(
    shipmentId: string,
    deliveryAgentId: string,
    actorId: string,
    input: { otpCode: string; proofPhotoUrl?: string },
  ) {
    const result = await sequelize.transaction(async (transaction) => {
      const shipment = await repo.assignedShipment(shipmentId, deliveryAgentId, transaction);
      if (!shipment) throw new NotFoundError('AssignedShipment');
      if (shipment.status !== 'OUT_FOR_DELIVERY') {
        throw new ValidationError({ status: ['Delivery must be out for delivery before confirmation'] });
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
          updatedBy: actorId,
        },
        transaction,
      );
      await logAudit({
        actorId,
        action: 'DELIVERY_CONFIRMED',
        entityType: 'Shipment',
        entityId: shipment.id,
        metadata: { otpVerified: true, proofProvided: Boolean(input.proofPhotoUrl) },
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
