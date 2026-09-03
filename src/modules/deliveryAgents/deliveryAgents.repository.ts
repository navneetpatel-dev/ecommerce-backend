import { Op, type Transaction } from 'sequelize';
import { BaseRepository } from '@core/repository/BaseRepository';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { User } from '@database/models/user.model';
import { Shipment } from '@database/models/shipment.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { Address } from '@database/models/address.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';

const deliveryAgentUserAttributes = ['id', 'email', 'name', 'phone', 'status'] as const;

const orderInclude = {
  model: SubOrder,
  as: 'subOrder',
  include: [{
    model: Order,
    as: 'order',
    include: [
      { model: Address, as: 'shippingAddress' },
      { model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] },
    ],
  }],
};

const pickupInclude = [
  { model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] },
  { model: SubOrder, as: 'subOrder', include: [{ model: Order, as: 'order', include: [{ model: Address, as: 'shippingAddress' }] }] },
  { model: OrderItem, as: 'orderItem' },
];

export class DeliveryAgentsRepository extends BaseRepository<DeliveryAgent> {
  constructor() {
    super(DeliveryAgent);
  }

  override async findById(id: string) {
    return super.findById(id, {
      include: [{ model: User, as: 'user', attributes: [...deliveryAgentUserAttributes] }],
    });
  }

  async findByUserId(userId: string) {
    return this.model.findOne({
      where: { userId },
      include: [{ model: User, as: 'user', attributes: [...deliveryAgentUserAttributes] }],
    });
  }

  async list(filters: { hubOrZone?: string; status?: string; page: number; limit: number }) {
    const where: any = {};
    if (filters.hubOrZone) {
      where.hubOrZone = { [Op.iLike]: `%${filters.hubOrZone}%` };
    }
    if (filters.status) {
      where.status = filters.status;
    }

    return this.model.findAndCountAll({
      where,
      include: [{ model: User, as: 'user', attributes: ['id', 'email', 'status'] }],
      limit: filters.limit,
      offset: (filters.page - 1) * filters.limit,
      order: [['createdAt', 'DESC']],
      distinct: true,
    });
  }

  async myDeliveries(deliveryAgentId: string, statuses?: string[]) {
    const where: any = { deliveryAgentId };
    if (statuses?.length) {
      where.status = { [Op.in]: statuses };
    }

    return Shipment.findAll({
      where,
      include: [orderInclude],
      order: [['assignedAt', 'DESC']],
    });
  }

  async assignedShipment(id: string, deliveryAgentId: string, transaction?: Transaction) {
    return Shipment.findOne({
      where: { id, deliveryAgentId },
      include: [orderInclude],
      transaction,
      lock: transaction?.LOCK.UPDATE,
    });
  }

  async myPickups(deliveryAgentId: string, statuses?: string[]) {
    const where: any = { deliveryAgentId };
    if (statuses?.length) {
      where.status = { [Op.in]: statuses };
    }

    return ReturnRequest.findAll({
      where,
      include: pickupInclude,
      order: [['updatedAt', 'DESC']],
    });
  }

  async assignedPickup(id: string, deliveryAgentId: string, transaction?: Transaction) {
    return ReturnRequest.findOne({
      where: { id, deliveryAgentId },
      include: pickupInclude,
      transaction,
      lock: transaction?.LOCK.UPDATE,
    });
  }

  async activeCounts(deliveryAgentId: string) {
    return Promise.all([
      Shipment.count({ where: { deliveryAgentId, status: { [Op.notIn]: ['DELIVERED', 'FAILED'] } } }),
      ReturnRequest.count({ where: { deliveryAgentId, status: 'PICKUP_SCHEDULED' } }),
    ]);
  }
}

export const deliveryAgentsRepository = new DeliveryAgentsRepository();
