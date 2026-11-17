/**
 * The short order reference quoted in emails, support tickets and the orders pages
 * (A1B2C3D4). One definition, so what a shopper reads in an email is what they see in
 * their account. The per-seller tax invoice number is a different thing: it only exists
 * once a part is dispatched.
 */
export function orderReference(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}
