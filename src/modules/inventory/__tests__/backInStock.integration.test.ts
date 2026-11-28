import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { notificationsService } from '@modules/notifications/notifications.service';
import { SKIP_ON_DEV_DB, rows, startCatalogWorld, unique, type CatalogWorld } from '../../../testHelpers/catalogFixtures';
import { stockAlertCancelUrl } from '../stockAlertLinks';

let world: CatalogWorld;
type Mail = { type: string; userId?: string | null; to?: { email: string }; templateData?: Record<string, unknown> };
let sent: Mail[] = [];

describe('back-in-stock alerts', { skip: SKIP_ON_DEV_DB }, () => {
  before(async () => {
    world = await startCatalogWorld();
    mock.method(notificationsService, 'enqueue', (async (mail: Mail) => {
      sent.push(mail);
      return {} as never;
    }) as never);
  });
  beforeEach(() => {
    sent = [];
  });
  after(async () => {
    mock.restoreAll();
    await world.close();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 600));
  const email = () => `alert-${unique()}@example.invalid`;
  const setStock = async (variantId: string, stock: number, expectedStock: number) => {
    world.expectStatus(
      await world.call('PATCH', `/inventory/variants/${variantId}/stock`, world.a.owner, { stock, expectedStock }), 200, 'stock',
    );
    await settle();
  };
  const alerts = (type: string) => sent.filter((mail) => mail.type === type);
  async function soldOut() {
    const product = await world.liveProduct(world.a, { stock: 0 });
    return product;
  }

  it('emails a guest (M3), never revealing the record (E4)', async () => {
    const product = await soldOut();
    const guest = email();
    const reply = await world.call('POST', '/inventory/stock-alerts', null, { variantId: product.variantId, guestEmail: guest });
    assert.equal(reply.status, 201, reply.text);
    assert.deepEqual(reply.data, { subscribed: true });
    assert.equal(alerts('STOCK_ALERT_CONFIRMED').length, 1);
    await setStock(product.variantId, 5, 0);
    const mail = alerts('STOCK_ALERT_REQUESTED').find((entry) => entry.to?.email === guest);
    assert.ok(mail, JSON.stringify(sent));
    assert.match(String(mail.templateData?.cancelAlertUrl), /stock-alerts\/cancel\?token=/);
  });

  it('fires again when the shopper asks again (M4)', async () => {
    const product = await soldOut();
    const ask = () => world.call('POST', '/inventory/stock-alerts', world.customer, { variantId: product.variantId });
    await ask();
    await setStock(product.variantId, 3, 0);
    await setStock(product.variantId, 0, 3);
    assert.equal((await ask()).data.notifiedAt, null);
    await setStock(product.variantId, 3, 0);
    assert.equal(alerts('STOCK_ALERT_REQUESTED').filter((mail) => mail.userId === world.customer.id).length, 2);
  });

  it('fires when a cancelled order gives the stock back (M5)', async () => {
    const product = await world.liveProduct(world.a, { stock: 1 });
    await rows('DELETE FROM cart_items WHERE "cartId" IN (SELECT id FROM carts WHERE "userId" = :id) RETURNING id', { id: world.customer.id });
    await world.call('POST', '/cart/items', world.customer, { variantId: product.variantId, quantity: 1 });
    const order = world.expectStatus(
      await world.call('POST', '/checkout', world.customer,
        { shippingAddressId: world.addressId, billingAddressId: world.addressId, paymentMethod: 'COD' }, { 'idempotency-key': unique() }),
      201, 'order',
    ).data;
    const guest = email();
    await world.call('POST', '/inventory/stock-alerts', null, { variantId: product.variantId, guestEmail: guest });
    const [part] = await rows<{ id: string }>('SELECT id FROM sub_orders WHERE "orderId" = :id', { id: order.orderId });
    world.expectStatus(await world.call('PATCH', `/suborders/${part!.id}/status`, world.a.owner, { status: 'CANCELLED', cancellationReason: 'Out of stock' }), 200, 'cancel');
    await settle();
    assert.ok(alerts('STOCK_ALERT_REQUESTED').some((mail) => mail.to?.email === guest), JSON.stringify(sent.map((m) => m.type)));
  });

  it('stays waiting while the listing cannot be bought or nothing could be queued (E6)', async () => {
    const product = await soldOut();
    const guest = email();
    await world.call('POST', '/inventory/stock-alerts', null, { variantId: product.variantId, guestEmail: guest });
    await world.call('POST', `/products/${product.id}/archive`, world.admin);
    sent = [];
    await setStock(product.variantId, 4, 0);
    assert.equal(alerts('STOCK_ALERT_REQUESTED').length, 0);
    const [row] = await rows<{ notifiedAt: Date | null }>('SELECT "notifiedAt" FROM stock_alerts WHERE "guestEmail" = :guest', { guest });
    assert.equal(row!.notifiedAt, null);
  });

  it('the cancel link removes the alert, and a forged one is refused', async () => {
    const product = await soldOut();
    const guest = email();
    await world.call('POST', '/inventory/stock-alerts', null, { variantId: product.variantId, guestEmail: guest });
    const find = () => rows<{ id: string }>('SELECT id FROM stock_alerts WHERE "guestEmail" = :guest', { guest });
    const [alert] = await find();
    const token = new URL(stockAlertCancelUrl(alert!.id)).searchParams.get('token');
    assert.equal((await world.call('POST', '/inventory/stock-alerts/unsubscribe', null, { token: 'forged' })).status, 422);
    assert.equal((await world.call('DELETE', `/inventory/stock-alerts/${alert!.id}`)).status, 401);
    assert.equal((await world.call('POST', '/inventory/stock-alerts/unsubscribe', null, { token })).status, 200);
    assert.equal((await find()).length, 0);
  });
});
