/**
 * What an order view may show of the seller and the delivery agent. Both models also hold
 * bank details, PAN, GSTIN and the agent's live location — never part of an order payload.
 */
export const ORDER_VENDOR_ATTRIBUTES = ['id', 'businessName', 'slug', 'logoUrl'];
export const ORDER_DELIVERY_AGENT_ATTRIBUTES = ['id', 'fullName', 'phone'];
