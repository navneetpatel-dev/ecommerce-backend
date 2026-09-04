import { Op, type Transaction } from 'sequelize';
import { BaseRepository } from '@core/repository/BaseRepository';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { DeliveryCashDeposit } from '@database/models/deliveryCashDeposit.model';
import { DeliveryAgentDocument } from '@database/models/deliveryAgentDocument.model';
import { User } from '@database/models/user.model';
import { Shipment } from '@database/models/shipment.model';
import { ShipmentAttempt } from '@database/models/shipmentAttempt.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { Address } from '@database/models/address.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Vendor } from '@database/models/vendor.model';
import { RETURN_STATUS } from '@core/constants/statuses';

const deliveryAgentUserAttributes = ['id', 'email', 'name', 'phone', 'status'] as const;

const orderInclude = {
  model: SubOrder,
  as: 'subOrder',
  include: [
    {
      model: Order,
      as: 'order',
      include: [
        { model: Address, as: 'shippingAddress' },
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] },
      ],
    },
    { model: OrderItem, as: 'items' },
  ],
};

const attemptsInclude = {
  model: ShipmentAttempt,
  as: 'attempts' as const,
  separate: true,
  order: [['attemptNumber', 'ASC']] as [string, string][],
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
      include: [orderInclude, attemptsInclude],
      order: [['assignedAt', 'DESC']],
    });
  }

  async assignedShipment(id: string, deliveryAgentId: string, transaction?: Transaction) {
    return Shipment.findOne({
      where: { id, deliveryAgentId },
      include: [orderInclude, attemptsInclude],
      transaction,
      lock: transaction?.LOCK.UPDATE,
    });
  }

  /** Backs the single-delivery detail route — no more loading the whole list to find one. */
  async shipmentById(id: string, deliveryAgentId: string) {
    return Shipment.findOne({ where: { id, deliveryAgentId }, include: [orderInclude, attemptsInclude] });
  }

  async findShipmentsByIds(ids: string[]) {
    return Shipment.findAll({ where: { id: { [Op.in]: ids } } });
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

  /** Backs the single-pickup detail route — no more loading the whole list to find one. */
  async pickupById(id: string, deliveryAgentId: string) {
    return ReturnRequest.findOne({ where: { id, deliveryAgentId }, include: pickupInclude });
  }

  async activeCounts(deliveryAgentId: string) {
    return Promise.all([
      Shipment.count({ where: { deliveryAgentId, status: { [Op.notIn]: ['DELIVERED', 'FAILED'] } } }),
      ReturnRequest.count({ where: { deliveryAgentId, status: 'PICKUP_SCHEDULED' } }),
    ]);
  }

  /** Shipments an admin can actually dispatch — the picker behind "manual dispatch". */
  async unassignedShipments() {
    return Shipment.findAll({
      where: {
        deliveryAgentId: { [Op.is]: null },
        status: { [Op.notIn]: ['DELIVERED', 'FAILED'] },
      },
      include: [{
        model: SubOrder,
        as: 'subOrder',
        include: [
          { model: Order, as: 'order', attributes: ['id'] },
          { model: Vendor, as: 'vendor', attributes: ['id', 'businessName'] },
        ],
      }],
      order: [['createdAt', 'ASC']],
      // Oldest-first, so whatever's waited longest surfaces first in the
      // picker; capped so the dropdown stays usable at any real backlog size.
      limit: 50,
    });
  }

  /** RTO parcels an agent is holding — admin visibility into the return-to-origin queue. */
  async rtoShipments() {
    return Shipment.findAll({
      where: { status: { [Op.in]: ['RTO_INITIATED', 'RTO_DELIVERED'] } },
      include: [
        orderInclude,
        { model: DeliveryAgent, as: 'deliveryAgent', attributes: ['id', 'fullName', 'phone', 'hubOrZone'] },
      ],
      order: [['lastFailedAttemptAt', 'DESC']],
      limit: 100,
    });
  }

  /** Return pickups an admin can actually dispatch — the picker behind "manual dispatch". */
  async unassignedPickups() {
    return ReturnRequest.findAll({
      where: {
        deliveryAgentId: { [Op.is]: null },
        status: RETURN_STATUS.PICKUP_SCHEDULED,
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] },
        { model: OrderItem, as: 'orderItem' },
        {
          model: SubOrder,
          as: 'subOrder',
          include: [{ model: Order, as: 'order', attributes: ['id'] }],
        },
      ],
      order: [['updatedAt', 'ASC']],
      limit: 50,
    });
  }

  createCashDeposit(data: {
    deliveryAgentId: string;
    amount: number;
    expectedAmount: number;
    note: string | null;
    createdBy: string;
  }) {
    return DeliveryCashDeposit.create({
      ...data,
      status: 'PENDING',
      rejectionReason: null,
      verifiedById: null,
      verifiedAt: null,
      updatedBy: null,
      deletedBy: null,
    });
  }

  cashDepositsForAgent(deliveryAgentId: string) {
    return DeliveryCashDeposit.findAll({ where: { deliveryAgentId }, order: [['createdAt', 'DESC']], limit: 30 });
  }

  findCashDepositById(id: string) {
    return DeliveryCashDeposit.findByPk(id);
  }

  listCashDeposits(status?: string) {
    return DeliveryCashDeposit.findAll({
      where: status ? { status } : {},
      include: [{ model: DeliveryAgent, as: 'deliveryAgent', attributes: ['id', 'fullName', 'hubOrZone'] }],
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
  }

  createDocument(data: {
    deliveryAgentId: string;
    type: string;
    url: string;
    createdBy: string;
  }) {
    return DeliveryAgentDocument.create({
      ...data,
      verified: false,
      verifiedById: null,
      rejectionReason: null,
      rejectedAt: null,
      updatedBy: null,
      deletedBy: null,
    } as any);
  }

  documentsForAgent(deliveryAgentId: string) {
    return DeliveryAgentDocument.findAll({ where: { deliveryAgentId }, order: [['createdAt', 'DESC']] });
  }

  findDocumentById(id: string) {
    return DeliveryAgentDocument.findByPk(id);
  }

  /** Full admin review queue — every submitted document, any state. */
  listAllDocuments() {
    return DeliveryAgentDocument.findAll({
      include: [{ model: DeliveryAgent, as: 'deliveryAgent', attributes: ['id', 'fullName', 'hubOrZone'] }],
      order: [['createdAt', 'ASC']],
      limit: 200,
    });
  }
}

export const deliveryAgentsRepository = new DeliveryAgentsRepository();
