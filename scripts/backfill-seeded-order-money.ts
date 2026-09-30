/**
 * Complete the money on the demo orders the comprehensive seeder bulk-inserts.
 *
 * `database/seeders/20240101000003-comprehensive-seed.js` writes only
 * `order_items.unitPricePaise`, `sub_orders.subtotalPaise` and `orders.totalAmount` — all
 * pre-GST, with every tax amount left at zero/NULL. Those orders therefore render as zero
 * money: `orderDisplayMappers` reads a line with no GST breakdown and zeroed amount columns
 * as "fully returned" (₹0 line totals, "Items (incl. GST) ₹0"), and the residual the bill
 * is left with (`totalAmount` − those rows) surfaces as a phantom "Return shipping fee".
 * Their tax invoices can never be downloaded either: a number is allocated only at dispatch
 * (`issueTaxInvoicesOnDispatch`), and a seeded part is born SHIPPED/DELIVERED without ever
 * passing through it.
 *
 * This re-prices each such order with the engine checkout itself uses
 * (`pricingService.computeVendorBreakdown`, GST per line from the product's category rule,
 * intra/inter-state from the vendor's state against the delivery address), writes the GST
 * money the way `checkout.service` writes it, freezes the vendor's `taxInvoiceSnapshot`,
 * restates the order's totals GST-inclusive, and then lets the real dispatch path allocate
 * invoice numbers for the parts already shipped or delivered.
 *
 * Deliberate deviations — these rows are fixtures, not sales:
 * - TCS stays unrecorded (`tcsAmountPaise` 0, `tcsRatePercent` NULL) so GSTR-8 and the
 *   ledger reports keep the seeder's shape; dispatch then records no TCS row for them.
 * - `commission_ledgers` rows are re-aligned to the part they book (rate and status stay as
 *   the seeder wrote them): the part is priced at the ledger's frozen rate, so the two agree
 *   to the paisa instead of drifting when a vendor's rate was edited after seeding.
 * - Seeded return requests are left alone (they were never applied to the order's money).
 * - An order-level seeded coupon (`orders.discountTotal`) is apportioned across the parts in
 *   proportion to their subtotals (as the cart does) and re-stated GST-inclusive, with the
 *   matching `coupon_usages.discountApplied` synced so the coupon report agrees.
 *
 * Idempotent: only orders checkout never priced (`orders.taxTotal IS NULL`) are candidates,
 * and a part that already has money or an invoice number is skipped — unless `--force` is
 * given, which re-prices the parts of the candidate orders (renumbering nothing) so they can
 * be re-aligned after a rule change.
 *
 * Usage (from `backend/`):
 *   npx tsx scripts/backfill-seeded-order-money.ts                       # dry run (default)
 *   npx tsx scripts/backfill-seeded-order-money.ts --apply
 *   npx tsx scripts/backfill-seeded-order-money.ts --apply --order-id <uuid>
 *   npx tsx scripts/backfill-seeded-order-money.ts --apply --limit 5
 *   npx tsx scripts/backfill-seeded-order-money.ts --apply --force --order-id <uuid>[,<uuid>...]
 *   npx tsx scripts/backfill-seeded-order-money.ts --apply --force --order-id <uuid> --discount-paise 24000
 */
import { Op, type WhereOptions } from 'sequelize';
import {
  Address,
  CommissionLedger,
  CouponUsage,
  Order,
  OrderItem,
  Product,
  ProductVariant,
  SubOrder,
  Vendor,
  sequelize,
} from '../database/models';
import { DISCOUNT_BEARER, ORDER_STATUS, type DiscountBearer } from '../src/core/constants/statuses';
import { allocateProportionally, fromPaise, roundMoney, toPaise } from '../src/modules/pricing/money';
import { lineTotal } from '../src/modules/pricing/displayMoney';
import { gstOnTaxablePaise } from '../src/modules/pricing/pricing.engine';
import { pricingService } from '../src/modules/pricing/pricing.service';
import { taxInvoiceSnapshotLine, type TaxInvoiceSnapshotLine } from '../src/modules/pricing/taxInvoiceSnapshot';
import { issueTaxInvoicesOnDispatch } from '../src/modules/pricing/taxInvoiceIssue';
import { mapOrderResponse } from '../src/modules/orders/orderDisplayMappers';
import { taxService } from '../src/modules/tax/tax.service';

interface Args {
  apply: boolean;
  force: boolean;
  /** Explicit orders to repair; when given, they are repaired whatever their totals. */
  orderIds: string[];
  /** Override the order-level pre-GST discount, in paise (a re-align of a coupon order). */
  discountPaise: number | null;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, force: false, orderIds: [], discountPaise: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') args.apply = true;
    else if (flag === '--force') args.force = true;
    else if (flag === '--discount-paise') {
      const value = Number(argv[i + 1] ?? '');
      args.discountPaise = Number.isFinite(value) ? Math.round(value) : null;
    } else if (flag === '--order-id') {
      args.orderIds.push(
        ...String(argv[i + 1] ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      );
    } else if (flag === '--limit') args.limit = Number(argv[i + 1] ?? '') || null;
  }
  return args;
}

/** A part as this script reads it: its vendor, its lines and each line's product. */
type PartRow = SubOrder & {
  vendor?: Vendor | null;
  items?: Array<
    OrderItem & {
      variant?: (ProductVariant & { product?: (Product & { categoryId?: string | null; hsnCode?: string | null }) | null }) | null;
    }
  >;
};

type OrderRow = Order & { subOrders?: PartRow[] };

/** Dispatch already happened for these: the tax invoice belongs on them now. */
const INVOICED_STATUSES: ReadonlySet<string> = new Set<string>([ORDER_STATUS.SHIPPED, ORDER_STATUS.DELIVERED]);

/** Intra-state is the same comparison the engine makes: trimmed, case-insensitive. */
function sameState(a: string | null | undefined, b: string | null | undefined): boolean {
  return (
    String(a ?? '')
      .trim()
      .toUpperCase() ===
    String(b ?? '')
      .trim()
      .toUpperCase()
  );
}

function summariseOrder(order: OrderRow): string {
  const parts = order.subOrders ?? [];
  return `${order.id} (${order.status}, ${parts.length} part${parts.length === 1 ? '' : 's'})`;
}

/** The money one part is re-priced to: what to persist, and what the order totals need. */
interface PartPricing {
  subtotalPaise: number;
  discountPaise: number;
  /** Value of supply (goods after the vendor's own share of a coupon). */
  taxPaise: number;
  /** The GST the customer paid on those goods. */
  taxTotalPaise: number;
  shippingPaise: number;
  customerPaise: number;
  /** Coupon taken off this part, GST included — exactly the API's `couponSavings`. */
  discountInclusivePaise: number;
  commissionBasePaise: number;
  commissionPaise: number;
  subValues: Record<string, unknown>;
  itemValues: Array<{ id: string; values: Record<string, unknown> }>;
}

/**
 * Price one part the way checkout would have: same engine, same per-line GST rule, same
 * intra/inter-state test, same columns. Returns the values to write (the caller owns the
 * transaction) or null when the part has nothing to price.
 */
async function pricePart(input: {
  part: PartRow;
  destinationState: string;
  /** This part's share of the order-level coupon, pre-GST as the seeder recorded it. */
  discountPaise: number;
  /**
   * The commission rate already frozen on this part's ledger row (the seeder's), when it
   * has one: a later vendor-rate edit must not rewrite commission that was booked.
   */
  commissionRatePercent?: number | undefined;
}): Promise<PartPricing | null> {
  const { part, destinationState } = input;
  const items = part.items ?? [];
  if (items.length === 0) return null;

  const vendor = part.vendor ?? null;
  const commissionRatePercent = input.commissionRatePercent ?? Number(vendor?.commissionRate ?? 0);
  const vendorState = vendor?.state ?? '';
  const intraState = sameState(vendorState, destinationState);

  // GST per line from the product's category rule (walking the category tree), the same
  // resolution checkout uses — never a flat rate.
  const rates: Array<Awaited<ReturnType<typeof taxService.getGstRateRule>>> = [];
  for (const item of items) {
    rates.push(await taxService.getGstRateRule(item.variant?.product?.categoryId ?? undefined));
  }

  const engineInput = {
    lines: items.map((item, index) => ({
      key: item.id,
      unitPrice: fromPaise(Number(item.unitPricePaise ?? 0)),
      quantity: item.quantity,
      gstPercentage: rates[index]!.gstPercentage,
      gstPriceBand: rates[index]!.gstPriceBand,
      commissionRatePercent,
    })),
    gstPercentage: rates[0]?.gstPercentage ?? 0,
    vendorStateCode: vendorState,
    shippingStateCode: destinationState,
    commissionRatePercent,
    discountBearer: DISCOUNT_BEARER.PLATFORM as DiscountBearer,
    // Fixtures: no TCS recorded (see the header note).
    tcsRatePercent: 0,
  };

  const priced = pricingService.computeVendorBreakdown({
    ...engineInput,
    merchandiseDiscount: fromPaise(input.discountPaise),
    vendorBorneMerchandiseDiscount: 0,
    shippingDiscount: 0,
    shippingCost: fromPaise(Number(part.shippingCostPaise ?? 0)),
  });
  const p = priced.paise;
  const r = priced.rupees;
  const lineByKey = new Map(p.lines.map((line) => [line.key, line]));

  // The coupon as the customer sees it: the line with GST before the coupon, less what was
  // paid for it — the same figure `orderDisplayMappers.partInclusiveItems` derives.
  const discountInclusivePaise = p.lines.reduce((sum, line) => {
    if (line.discountPaise <= 0) return sum;
    const grossPaise = line.lineSubtotalPaise + gstOnTaxablePaise(line.lineSubtotalPaise, line.tax.gstPercentage, intraState).total;
    return sum + (grossPaise - (line.taxablePaise + line.tax.total));
  }, 0);

  // The vendor's invoice freezes the value of supply and its GST (the platform pays its
  // share of a platform-funded coupon), exactly as checkout freezes it.
  const invoiceLines: TaxInvoiceSnapshotLine[] = [];
  for (const item of items) {
    const line = lineByKey.get(item.id);
    if (!line) continue;
    const product = item.variant?.product ?? null;
    const hsnCode = await taxService.resolveHsnCode({
      hsnCode: product?.hsnCode ?? null,
      categoryId: product?.categoryId ?? null,
    });
    invoiceLines.push(taxInvoiceSnapshotLine(item.id, line, hsnCode));
  }
  const invoiceValuePaise = p.supplyTaxablePaise + p.supplyTax.total;
  const platformContributionPaise = invoiceValuePaise - (p.taxablePaise + p.tax.total);

  return {
    subtotalPaise: p.subtotalPaise,
    discountPaise: p.merchandiseDiscountPaise,
    taxPaise: p.taxablePaise,
    taxTotalPaise: p.tax.total,
    shippingPaise: p.shippingChargedPaise,
    customerPaise: p.customerTotalPaise,
    discountInclusivePaise,
    commissionBasePaise: p.commissionBasePaise,
    commissionPaise: p.commissionPaise,
    subValues: {
      subtotalPaise: p.subtotalPaise,
      shippingCharged: r.shippingCharged,
      customerTotal: r.customerTotal,
      taxBreakdown: r.tax,
      shippingCostPaise: p.shippingCostPaise,
      shippingDiscountAmountPaise: p.shippingDiscountPaise,
      taxAmountPaise: p.tax.total,
      taxableAmountPaise: p.taxablePaise,
      supplyTaxablePaise: p.supplyTaxablePaise,
      supplyTaxPaise: p.supplyTax.total,
      discountAmountPaise: p.merchandiseDiscountPaise,
      commissionAmountPaise: p.commissionPaise,
      tcsAmountPaise: p.tcsPaise,
      netPayoutAmountPaise: p.netPayoutPaise,
      roundingAdjustmentPaise: p.roundingAdjustmentPaise,
      taxInvoiceSnapshot: {
        totalPaise: invoiceValuePaise,
        lines: invoiceLines,
        ...(platformContributionPaise > 0 ? { platformContributionPaise } : {}),
      },
    },
    itemValues: items.map((item) => {
      const line = lineByKey.get(item.id)!;
      const rupees = priced.rupees.lines.find((row) => row.key === item.id)!;
      return {
        id: item.id,
        values: {
          lineSubtotal: rupees.lineSubtotal,
          lineTotal: lineTotal(rupees.taxableAmount, rupees.tax.total),
          taxBreakdown: rupees.tax,
          discountAmountPaise: line.discountPaise,
          taxableAmountPaise: line.taxablePaise,
          taxAmountPaise: line.tax.total,
          supplyTaxablePaise: line.supplyTaxablePaise,
          supplyTaxPaise: line.supplyTax.total,
          commissionAmountPaise: line.commissionPaise,
          tcsAmountPaise: line.tcsPaise,
          netPayoutAmountPaise: line.netPayoutPaise,
        },
      };
    }),
  };
}

/** What one order's repair did (or would do, on a dry run). */
interface OrderOutcome {
  order: OrderRow;
  pricedParts: number;
  invoicedParts: number;
  skipped: string[];
  beforePaise: number;
  afterPaise: number;
}

/**
 * Re-price an order's untouched parts, restate its totals GST-inclusive and invoice the
 * parts already dispatched. One transaction per order so `issueTaxInvoicesOnDispatch` sees
 * the snapshot that was just frozen on the part.
 */
async function repairOrder(input: {
  order: OrderRow;
  destinationState: string;
  apply: boolean;
  /** Re-price parts that already carry money (used to re-align them after a rule change). */
  force: boolean;
  /** Order-level pre-GST discount to use instead of what the rows already carry, in paise. */
  discountPaise: number | null;
}): Promise<OrderOutcome> {
  const { order, destinationState, apply, force } = input;
  const parts = order.subOrders ?? [];
  const beforePaise = toPaise(order.totalAmount);
  const skipped: string[] = [];

  const candidates: PartRow[] = [];
  for (const part of parts) {
    const alreadyPriced =
      Number(part.taxableAmountPaise ?? 0) > 0 || Number(part.taxAmountPaise ?? 0) > 0 || Boolean(part.taxInvoiceNumber);
    if (alreadyPriced && !force) {
      skipped.push(`${part.id} already priced or invoiced`);
      continue;
    }
    if ((part.items ?? []).length === 0) {
      skipped.push(`${part.id} has no order items`);
      continue;
    }
    candidates.push(part);
  }

  if (candidates.length === 0) {
    return {
      order,
      pricedParts: 0,
      invoicedParts: 0,
      skipped,
      beforePaise,
      afterPaise: beforePaise,
    };
  }

  // Coupon: on a first run nothing per line is recorded, so the seeded order-level amount
  // (pre-GST, as the seeder computed it) is split across the parts in proportion to their
  // subtotals, the way the cart splits a coupon. Once the parts carry their own per-line
  // discounts, those are the source (re-reading `discountTotal` would double-count it, since
  // it is the GST-inclusive coupon the bill shows).
  const storedDiscounts = candidates.map((part) =>
    (part.items ?? []).reduce((sum, item) => sum + Number(item.discountAmountPaise ?? 0), 0),
  );
  const discountShares =
    input.discountPaise != null
      ? allocateProportionally(
          input.discountPaise,
          candidates.map((part) => Number(part.subtotalPaise ?? 0)),
        )
      : storedDiscounts.some((paise) => paise > 0)
        ? storedDiscounts
        : allocateProportionally(
            toPaise(order.discountTotal),
            candidates.map((part) => Number(part.subtotalPaise ?? 0)),
          );

  const pricedRows: Array<PartPricing | null> = [];
  // A part's ledger row freezes the commission rate it was booked at; price it at that rate
  // rather than the vendor's current one, and re-align the ledger's amounts afterwards.
  const ledgers = await CommissionLedger.findAll({
    where: { subOrderId: candidates.map((part) => part.id) },
    attributes: ['id', 'subOrderId', 'commissionRate'],
  });
  const ledgerRateByPart = new Map(ledgers.map((row) => [row.subOrderId, Number(row.commissionRate)]));
  for (const [index, part] of candidates.entries()) {
    pricedRows.push(
      await pricePart({
        part,
        destinationState,
        discountPaise: discountShares[index] ?? 0,
        commissionRatePercent: ledgerRateByPart.get(part.id),
      }),
    );
  }

  let subtotalPaise = 0;
  let taxTotalPaise = 0;
  let couponPaise = 0;
  let shippingPaise = 0;
  let customerPaise = 0;
  for (const row of pricedRows) {
    if (!row) continue;
    subtotalPaise += row.subtotalPaise;
    taxTotalPaise += row.taxTotalPaise;
    couponPaise += row.discountInclusivePaise;
    shippingPaise += row.shippingPaise;
    customerPaise += row.customerPaise;
  }
  // Gift wrap stays on the order (the platform's own line), so the parts' totals plus it
  // are exactly what the customer paid.
  const afterPaise = customerPaise + toPaise(order.giftWrapFeeAmount ?? 0);
  const toInvoice = candidates.filter((part) => INVOICED_STATUSES.has(part.status));

  if (!apply) {
    return {
      order,
      pricedParts: candidates.length,
      invoicedParts: toInvoice.length,
      skipped,
      beforePaise,
      afterPaise,
    };
  }

  await sequelize.transaction(async (transaction) => {
    for (const [index, part] of candidates.entries()) {
      const row = pricedRows[index];
      if (!row) continue;
      await part.update(row.subValues, { transaction });
      for (const item of row.itemValues) {
        await OrderItem.update(item.values, { where: { id: item.id }, transaction });
      }
      // Keep the fixture's ledger row on the same figures as the part it books (the rate and
      // status stay as the seeder wrote them) so commission reports reconcile exactly.
      if (ledgerRateByPart.has(part.id)) {
        await CommissionLedger.update(
          {
            saleAmountPaise: row.commissionBasePaise,
            commissionAmountPaise: row.commissionPaise,
          },
          { where: { subOrderId: part.id }, transaction },
        );
      }
    }

    // The bill the customer sees: items with GST less coupons, plus shipping — GST
    // inclusive, all of it, exactly as `orderDisplayMappers` recomputes it.
    await order.update(
      {
        merchandiseSubtotal: fromPaise(subtotalPaise),
        taxTotal: fromPaise(taxTotalPaise),
        shippingTotal: fromPaise(shippingPaise),
        totalAmount: fromPaise(afterPaise),
        discountTotal: fromPaise(couponPaise),
      },
      { transaction },
    );

    // The coupon report reads what the coupon took off: keep it on the same GST-inclusive
    // figure the order page now shows.
    if (couponPaise > 0) {
      await CouponUsage.update({ discountApplied: fromPaise(couponPaise) }, { where: { orderId: order.id }, transaction });
    }

    // The real dispatch path: it allocates the vendor-scoped number and date from the
    // frozen snapshot, and skips a part that is reversed or already numbered.
    for (const part of toInvoice) {
      await issueTaxInvoicesOnDispatch(part.id, transaction);
    }
  });

  return {
    order,
    pricedParts: candidates.length,
    invoicedParts: toInvoice.length,
    skipped,
    beforePaise,
    afterPaise,
  };
}

/** The includes the order detail endpoint uses, so the check reads what the page reads. */
const DISPLAY_INCLUDE = [
  {
    association: 'subOrders',
    include: [
      { model: Vendor, as: 'vendor' },
      {
        model: OrderItem,
        as: 'items',
        include: [
          {
            model: ProductVariant,
            as: 'variant',
            required: false,
            include: [
              {
                model: Product,
                as: 'product',
                required: false,
                paranoid: false,
                include: ['images'],
              },
            ],
          },
        ],
      },
    ],
  },
  { association: 'shippingAddress' },
];

/**
 * Read the order back the way the customer's page does (`mapOrderResponse`) and check the
 * three things that were wrong: zero items, a phantom return adjustment, and an unanswered
 * invoice button on a part that has shipped.
 */
async function verifyOrder(orderId: string): Promise<string[]> {
  const row = (await Order.findByPk(orderId, { include: DISPLAY_INCLUDE as never })) as
    (Order & { get: (opts: { plain: boolean }) => Record<string, unknown> }) | null;
  if (!row) return ['order not found'];
  const mapped = mapOrderResponse(row as unknown as Record<string, unknown>);
  const problems: string[] = [];
  const items = roundMoney(mapped.itemsTotal);
  const coupon = roundMoney(mapped.couponSavings);
  const shipping = roundMoney(mapped.shippingTotal);
  const giftWrap = roundMoney(mapped.giftWrapFeeAmount ?? 0);
  if (!(items > 0)) problems.push('items (incl. GST) is still zero');
  if (mapped.returnAdjustment != null) {
    problems.push(`phantom return adjustment of ${mapped.returnAdjustment.amount}`);
  }
  if (roundMoney(items - coupon + shipping + giftWrap) !== roundMoney(mapped.totalAmount)) {
    problems.push(`bill does not add up: ${items} - ${coupon} + ${shipping} + ${giftWrap} != ${mapped.totalAmount}`);
  }
  for (const sub of mapped.subOrders) {
    const needsInvoice = sub.status === ORDER_STATUS.SHIPPED || sub.status === ORDER_STATUS.DELIVERED;
    if (needsInvoice && !sub.taxInvoiceNumber) {
      problems.push(`part ${sub.id} is ${sub.status} but has no tax invoice number`);
    }
    if (sub.taxInvoiceNumber && !sub.taxInvoiceIssuedAt) {
      problems.push(`part ${sub.id} has an invoice number but no issue date`);
    }
  }
  return problems;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await sequelize.authenticate();

  // Without explicit ids: only orders checkout never priced (it always writes taxTotal), so
  // a normal run can never touch a real sale. With explicit ids the caller has named the
  // orders (a re-align), and `--force` is still required to touch parts that already carry
  // money.
  const orders = (await Order.findAll({
    // A real order always has taxTotal; the null filter is why the cast is needed.
    where: (args.orderIds.length ? { id: { [Op.in]: args.orderIds } } : { taxTotal: null }) as WhereOptions,
    include: [
      {
        association: 'subOrders',
        include: [
          { model: Vendor, as: 'vendor' },
          {
            model: OrderItem,
            as: 'items',
            include: [
              {
                model: ProductVariant,
                as: 'variant',
                required: false,
                include: [{ model: Product, as: 'product', required: false, paranoid: false }],
              },
            ],
          },
        ],
      },
      { association: 'shippingAddress' },
    ] as never,
    order: [['createdAt', 'ASC']],
    ...(args.limit ? { limit: args.limit } : {}),
  })) as unknown as Array<OrderRow & { shippingAddress?: Address | null }>;

  console.log(`${args.apply ? 'APPLYING' : 'DRY RUN'} — ${orders.length} order(s) with no checkout money`);

  const outcomes: OrderOutcome[] = [];
  for (const order of orders) {
    const outcome = await repairOrder({
      order,
      destinationState: String(order.shippingAddress?.state ?? '').trim(),
      apply: args.apply,
      force: args.force,
      discountPaise: args.discountPaise,
    });
    outcomes.push(outcome);
    const itemCount = (order.subOrders ?? []).reduce((sum, part) => sum + (part.items ?? []).length, 0);
    console.log(
      `  ${summariseOrder(order)} | ${itemCount} item(s) | ${fromPaise(outcome.beforePaise)} -> ` +
        `${fromPaise(outcome.afterPaise)} | re-price ${outcome.pricedParts} part(s), ` +
        `${outcome.invoicedParts} invoice(s)${args.apply ? '' : ' (planned)'}`,
    );
    for (const note of outcome.skipped) console.log(`      skipped: ${note}`);
  }

  const pricedParts = outcomes.reduce((sum, row) => sum + row.pricedParts, 0);
  const invoicedParts = outcomes.reduce((sum, row) => sum + row.invoicedParts, 0);
  const skippedParts = outcomes.reduce((sum, row) => sum + row.skipped.length, 0);
  console.log(
    `\n${pricedParts} part(s) re-priced, ${invoicedParts} tax invoice(s) ` +
      `${args.apply ? 'issued' : 'to issue'}, ${skippedParts} part(s) skipped.`,
  );

  if (!args.apply) {
    console.log('Dry run: nothing written. Re-run with --apply to repair the rows.');
    await sequelize.close();
    return;
  }

  // Read the repaired orders back through the display mapper (what the order page runs):
  // zero items, a phantom return fee or a missing number on a shipped part all fail here.
  let failures = 0;
  for (const outcome of outcomes) {
    if (outcome.pricedParts === 0) continue;
    const problems = await verifyOrder(outcome.order.id);
    if (problems.length > 0) {
      failures += 1;
      console.error(`  FAIL ${outcome.order.id}: ${problems.join('; ')}`);
    }
  }
  console.log(
    failures === 0
      ? 'Verified: every repaired order shows non-zero items, no return adjustment, and a number on each dispatched part.'
      : `${failures} order(s) still fail the display check.`,
  );
  if (failures > 0) process.exitCode = 1;

  await sequelize.close();
}

main().catch(async (error) => {
  console.error(error);
  await sequelize.close().catch(() => undefined);
  process.exitCode = 1;
});
