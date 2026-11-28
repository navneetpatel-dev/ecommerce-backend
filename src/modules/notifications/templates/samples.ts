import type { NotificationType } from '@database/models/notificationLog.model';
import { env } from '@config/env';
import { inr } from './blocks';
import type { EmailTemplateData } from './cta';

const ORDER_ITEMS = [
  { name: 'Audio Elite 10 Wireless Headphones', meta: 'Black · Sold by TechWorld', quantity: 1, price: inr(2189.85), imageUrl: null },
  { name: 'Children Ultra 124 Story Book Set', meta: 'Sold by BookNook', quantity: 2, price: inr(1299), imageUrl: null },
];
const ORDER_TOTALS = [
  { label: 'Subtotal', value: inr(4488) },
  { label: 'Shipping', value: inr(49) },
  { label: 'Discount', value: `−${inr(120)}` },
  { label: 'Total paid', value: inr(4417), strong: true },
];
const ADDRESS = 'Karan Joshi\n12, MG Road, Indiranagar\nBengaluru, Karnataka 560001';

/** Realistic data for every email, so the admin can preview and test-send any template. */
const BASE: EmailTemplateData = {
  customerName: 'Karan Joshi',
  name: 'Karan Joshi',
  orderNumber: 'A1B2C3D4',
  orderId: 'a1b2c3d4-0000-0000-0000-000000000000',
  returnId: 'r1r2r3r4-0000-0000-0000-000000000000',
  ticketId: 't1t2t3t4-0000-0000-0000-000000000000',
  bugReportId: 'b1b2b3b4-0000-0000-0000-000000000000',
  total: 4417,
  subtotal: 2000,
  amount: 2189.85,
  price: 999,
  code: 'SAVE20',
  expiresInMinutes: 5,
  productName: 'Audio Elite 10',
  productList: 'Audio Elite 10 (1); Travel Mug (2)',
  sku: 'AE-10-BLK',
  stock: 3,
  businessName: 'TechWorld',
  reason: 'The document was blurry; please upload a clearer scan.',
  trackingId: 'DLV48213377',
  trackingNumber: 'DLV48213377',
  paymentMethod: 'NEFT',
  paymentReferenceNumber: 'UTR98234112',
  usedCount: 90,
  usageLimit: 100,
  expiresAt: '30 Nov 2026',
  ticketNumber: 'TKT-1001',
  subject: 'Where is my order?',
  reportNumber: 'BUG-12',
  duplicateOfReportNumber: 'BUG-3',
  title: 'Cart total shows the wrong amount',
  status: 'APPROVED',
  statusText: 'approved',
  amountInr: 500,
  reasonMessage: 'Your bank declined the payment.',
  message: 'Big weekend sale — up to 40% off across the store.',
  vendorName: 'TechWorld',
  answerText: 'Yes, it comes with a 2-year warranty.',
  response: 'Thanks for the feedback — glad you like it!',
  cancelledBy: 'the customer',
  reportType: 'gmv-sales',
  rowCount: 120,
  supportEmail: 'support@marketplace.example',
  supportHours: 'Mon–Sat, 9:00 AM–7:00 PM',
  period: '10 – 16 Nov 2026',
};

const OVERRIDES: Partial<Record<NotificationType, EmailTemplateData>> = {
  LOGIN_OTP: { code: '482916', codeBox: { code: '482916', caption: 'Expires in 5 minutes · one use only' } },
  WELCOME: {
    codeBox: { code: 'WELCOME-7K3P9Q', caption: '10% off your first order (up to ₹200) · valid 30 days' },
    couponCode: 'WELCOME-7K3P9Q',
  },
  NEW_DEVICE_LOGIN: {
    details: [
      { label: 'Device', value: 'Chrome on macOS' },
      { label: 'Approx. location', value: 'Bengaluru, India' },
      { label: 'Time', value: '17 Nov 2026, 11:42 PM' },
    ],
    callout: { tone: 'warning', text: 'If this was not you, reset your password now and sign out of all devices.' },
  },
  CONTACT_ACKNOWLEDGEMENT: {
    reference: 'CM-7F3A9C',
    details: [{ label: 'Reference', value: 'CM-7F3A9C' }, { label: 'Topic', value: 'Order help' }, { label: 'Subject', value: 'Where is my order?' }],
  },
  ORDER_CONFIRMATION: {
    items: ORDER_ITEMS, totals: ORDER_TOTALS,
    details: [{ label: 'Order', value: '#A1B2C3D4', strong: true }, { label: 'Payment', value: 'Paid online (UPI)' }, { label: 'Ship to', value: ADDRESS }, { label: 'Estimated delivery', value: '20 – 23 Nov' }],
    detailsTitle: 'Delivery details',
  },
  PAYMENT_RECEIPT: { totals: ORDER_TOTALS, details: [{ label: 'Payment method', value: 'UPI' }, { label: 'Reference', value: 'pay_QX82a91' }] },
  SUBORDER_SHIPPED: { items: ORDER_ITEMS.slice(0, 1), details: [{ label: 'Carrier', value: 'Delhivery' }, { label: 'Tracking number', value: 'DLV48213377' }, { label: 'Estimated delivery', value: '20 Nov' }] },
  ORDER_OUT_FOR_DELIVERY: { items: ORDER_ITEMS.slice(0, 1), details: [{ label: 'Tracking number', value: 'DLV48213377' }] },
  SUBORDER_DELIVERED: { items: ORDER_ITEMS.slice(0, 1) },
  ORDER_CANCELLED: { details: [{ label: 'Refund', value: `${inr(4417)} to your original payment method` }] },
  SUBORDER_CANCELLED: { items: ORDER_ITEMS.slice(1) },
  VENDOR_NEW_ORDER: { items: ORDER_ITEMS.slice(0, 1), details: [{ label: 'Ship to', value: 'Bengaluru, Karnataka 560001' }, { label: 'Ship by', value: '19 Nov' }] },
  REFUND_INITIATED: { details: [{ label: 'Refund to', value: 'Original payment method' }, { label: 'Expected by', value: '24 – 26 Nov' }] },
  RETURN_REQUESTED: { items: ORDER_ITEMS.slice(0, 1), details: [{ label: 'Reason', value: 'Item not as described' }] },
  RETURN_APPROVED: { nextStep: 'We will schedule a pickup and let you know the time slot.' },
  RETURN_REJECTED: { reason: 'The item shows signs of use outside the return policy.' },
  RETURN_PICKUP_SCHEDULED: { details: [{ label: 'Pickup', value: '21 Nov, 10 AM – 2 PM' }, { label: 'Address', value: ADDRESS }] },
  WALLET_RECHARGE_SUCCESS: { details: [{ label: 'Points added', value: '1,000' }, { label: 'New balance', value: '3,250 points' }] },
  CASHBACK_CREDITED: { amount: 120, details: [{ label: 'Wallet balance', value: '3,370 points' }] },
  POINTS_EXPIRING: { points: '400', expiresAt: '30 Nov 2026' },
  GIFT_CARD_PURCHASED: { recipientName: 'Asha', amount: 1000, details: [{ label: 'Sent to', value: 'asha@example.com' }, { label: 'Message', value: 'Happy birthday!' }] },
  GIFT_CARD_RECEIVED: { purchaserName: 'Karan Joshi', amount: 1000, codeBox: { code: 'GC-9XK2-77PL', caption: 'Gift card code' }, actionUrl: `${env.CLIENT_URL}/gift-cards/redeem/GC-9XK2-77PL` },
  GIFT_CARD_REDEEMED: { recipientName: 'Asha', amount: 1000 },
  CHECKOUT_PAYMENT_PENDING: { expiresAt: '6:30 PM today', items: ORDER_ITEMS.slice(0, 1) },
  TICKET_AUTO_CLOSED: {}, TICKET_REOPEN_WINDOW_ENDING: { expiresAt: '24 Nov 2026' },
  REVIEW_REJECTED: { reason: 'Reviews cannot include personal contact details.' },
  WISHLIST_DIGEST: {
    items: [
      { name: 'Audio Elite 10', meta: 'Price dropped to ₹1,899.00 (was ₹2,189.85)', quantity: 1, price: inr(1899), imageUrl: null },
      { name: 'Trail Runner Pro Shoes', meta: 'Back in stock', quantity: 1, price: inr(3499), imageUrl: null },
    ],
    itemsTitle: 'On your wishlist', unsubscribeUrl: `${env.CLIENT_URL}/unsubscribe`,
  },
  KYC_DOCUMENT_RECEIVED: { documentName: 'GST certificate' },
  KYC_DOCUMENT_APPROVED: { documentName: 'GST certificate', progress: '2 of 3 documents are approved.' },
  KYC_PENDING_REMINDER: { bullets: ['PAN card — not uploaded', 'Cancelled cheque — rejected, upload a clearer copy'] },
  VENDOR_STAFF_INVITE: { inviterName: 'Ravi Kumar', roleName: 'Catalog staff', details: [{ label: 'Sign in with', value: 'staff@techworld.com' }, { label: 'Temporary password', value: 'Shown once — change it after signing in' }] },
  VENDOR_STAFF_ROLE_CHANGED: { roleName: 'Owner' },
  VENDOR_RETURN_REQUESTED: { details: [{ label: 'Item', value: 'Audio Elite 10 × 1' }, { label: 'Reason', value: 'Item not as described' }] },
  VENDOR_NEW_QUESTION: { questionText: 'Does it support multipoint pairing?' },
  VENDOR_NEW_REVIEW: { rating: '5', details: [{ label: 'Review', value: '“Great sound for the price.”' }] },
  COMMISSION_INVOICE_READY: { period: 'October 2026', details: [{ label: 'Commission', value: inr(8420) }, { label: 'GST on commission', value: inr(1515.6) }] },
  VENDOR_WEEKLY_SUMMARY: {
    details: [{ label: 'Orders', value: '38 (+12%)' }, { label: 'Revenue', value: inr(86450) }, { label: 'Units sold', value: '61' }, { label: 'Returns', value: '2' }, { label: 'Top product', value: 'Audio Elite 10' }],
    bullets: ['3 products are low on stock', '1 return needs your review'],
  },
  PAYOUT_PAID: { details: [{ label: 'Gross sales', value: inr(52000) }, { label: 'TDS', value: `−${inr(52)}` }, { label: 'Commission GST', value: `−${inr(1515.6)}` }, { label: 'Paid out', value: inr(2189.85), strong: true }] },
  ADMIN_RETURN_ESCALATION: { reason: 'Customer disputes the seller\'s rejection.' },
  ADMIN_NEW_BUG_REPORT: {},
  ADMIN_VENDOR_PRODUCT_EDITED: { vendorName: 'TechWorld', changes: 'name, images' },
  ADMIN_CONTACT_ENQUIRY: { senderName: 'Karan Joshi', senderEmail: 'karan.joshi0@example.com', details: [{ label: 'Topic', value: 'Order help' }, { label: 'Subject', value: 'Where is my order?' }, { label: 'Message', value: 'My order A1B2C3D4 has not moved since Monday.' }] },
  ADMIN_SETTINGS_CHANGED: { actorName: 'Super Admin', details: [{ label: 'Maintenance mode', value: 'Off → On' }, { label: 'Payout cycle', value: 'Weekly → Monthly' }] },
  ADMIN_DAILY_DIGEST: {
    period: '17 Nov 2026',
    details: [{ label: 'Vendors awaiting approval', value: '3' }, { label: 'Products awaiting approval', value: '31' }, { label: 'Returns awaiting action', value: '5' }, { label: 'Failed payouts', value: '0' }, { label: 'Emails failed or stuck', value: '2' }],
  },
  NEWSLETTER_CONFIRM: { actionUrl: `${env.CLIENT_URL}/newsletter/confirm?token=sample` },
};

export function sampleEmailData(type: NotificationType): EmailTemplateData {
  return { ...BASE, ...(OVERRIDES[type] ?? {}) };
}
