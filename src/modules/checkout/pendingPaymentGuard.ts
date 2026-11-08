import { Order } from '@database/models/order.model';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { PAYMENT_STATUS } from '@core/constants/statuses';
import { paymentsService } from '@modules/payments/payments.service';
import { razorpayOrderPayments } from '@modules/payments/razorpayOrderPayments';

export function paidCannotCancel() {
  return new AppError(ERROR_MESSAGES.CHECKOUT_PAID_CANNOT_CANCEL, 409, ERROR_CODES.CHECKOUT_PAID_CANNOT_CANCEL);
}

/**
 * Before a closed checkout is cancelled: Razorpay may already hold its payment (a UPI
 * approval landing as the customer closes the window, its webhook not in yet). A captured
 * one confirms the order; either way it is paid, not cancelled.
 */
export async function confirmIfPaidAtGateway(orderId: string, userId: string): Promise<void> {
  const order = await Order.findByPk(orderId, {
    attributes: ['id', 'userId', 'paymentStatus', 'razorpayOrderId'],
  });
  if (!order || order.userId !== userId || !order.razorpayOrderId) return;
  if (order.paymentStatus === PAYMENT_STATUS.PAID) return;
  const gateway = await razorpayOrderPayments.fetch(order.razorpayOrderId);
  if (gateway?.captured) await paymentsService.confirmCapturedPayment(gateway.captured);
  if (gateway?.captured || gateway?.authorized) throw paidCannotCancel();
}
