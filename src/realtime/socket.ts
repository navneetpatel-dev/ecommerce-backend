import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { BEARER_PREFIX } from '@core/constants/http';
import { ADMIN_ROLES, ROLES } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/constants/permissions';
import { userHasPermission } from '@middleware/rbac.middleware';
import { loadUserFromBearer } from '@middleware/auth.middleware';
import { Shipment } from '@database/models/shipment.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';

type SocketUser = {
  id: string;
  vendorId: string | null;
  deliveryAgentId: string | null;
  role: { name: string };
} | null;

let io: SocketIOServer | null = null;

/**
 * Live GPS beaconing transport for the delivery module. A single event pair:
 * client emits `subscribe:shipment` (guarded by the same authorization rules
 * as the REST tracking lookup — admin, order owner, vendor owner, delivery
 * agent, or an unauthenticated guest who only ever receives location pings,
 * never shipment data); server pushes `location:update` to that shipment's
 * room whenever the assigned agent's location changes.
 */
export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    path: '/socket.io',
    cors: {
      origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      socket.data.user = null as SocketUser;
      next();
      return;
    }
    const result = await loadUserFromBearer(`${BEARER_PREFIX}${token}`);
    socket.data.user = ('error' in result && result.error) ? null : (result.user as SocketUser);
    next();
  });

  io.on('connection', (socket) => {
    socket.on(
      'subscribe:shipment',
      async (
        payload: { trackingNumber?: string },
        ack?: (res: { ok: boolean; message?: string }) => void,
      ) => {
        try {
          const trackingNumber = String(payload?.trackingNumber ?? '').trim();
          if (!trackingNumber) {
            ack?.({ ok: false, message: 'Tracking number required' });
            return;
          }
          const shipment = await Shipment.findOne({
            where: { trackingNumber },
            include: [
              {
                model: SubOrder,
                as: 'subOrder',
                include: [{ model: Order, as: 'order', attributes: ['userId'] }],
                attributes: ['vendorId'],
              },
            ],
          });
          if (!shipment) {
            ack?.({ ok: false, message: 'Shipment not found' });
            return;
          }

          const user = socket.data.user as SocketUser;
          const subOrder = (shipment as Shipment & { subOrder?: SubOrder & { order?: Order } })
            .subOrder;
          const isAdmin =
            Boolean(user) &&
            ((ADMIN_ROLES as readonly string[]).includes(user!.role.name) ||
              (await userHasPermission(user as any, PERMISSIONS.SHIPPING_MANAGE, PERMISSIONS.ORDER_MANAGE)));
          const isCustomerOwner =
            Boolean(user) && user!.role.name === ROLES.CUSTOMER && subOrder?.order?.userId === user!.id;
          const isVendorOwner = Boolean(user) && user!.vendorId != null && subOrder?.vendorId === user!.vendorId;
          const isDeliveryAgent = Boolean(user) && user!.role.name === ROLES.DELIVERY_AGENT;
          if (user && !isAdmin && !isCustomerOwner && !isVendorOwner && !isDeliveryAgent) {
            ack?.({ ok: false, message: 'Not authorized for this shipment' });
            return;
          }

          socket.join(`shipment:${shipment.id}`);
          ack?.({ ok: true });
        } catch (error) {
          logger.warn('socket subscribe:shipment failed', {
            error: error instanceof Error ? error.message : error,
          });
          ack?.({ ok: false, message: 'Could not subscribe' });
        }
      },
    );
  });

  logger.info('Socket.IO realtime server initialized');
  return io;
}

/** Called by deliveryAgentsService.updateLocation after persisting the agent's fix. */
export function emitShipmentLocation(
  shipmentId: string,
  payload: { lat: number; lng: number; updatedAt: string },
): void {
  io?.to(`shipment:${shipmentId}`).emit('location:update', { shipmentId, ...payload });
}
