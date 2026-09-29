# Calculation gaps — fix plan and checklist

Audit of the Admin, Vendor, Customer and GST report module (43 gaps). Tick an item when its fix
is committed with tests; the phase's PR links are listed under each phase. Each phase ships as one backend PR (plus a web PR
where the screen changes).

## Decisions (agreed)

- **194-O catch-up (#16):** yes. Once a sole proprietor's sales for the year cross the
  exemption limit, the next payout deducts TDS on the year's sales less TDS already
  taken (same rule as 194C for delivery agents).
- **Platform-funded coupons (#18):** the vendor's GST is on the price before the
  platform's share of the coupon. The customer's total does not change; the platform
  pays the extra GST to the vendor with the coupon reimbursement. TCS and 194-O use
  the same value.
- **Return fee and shipping refund (#39):** the return fee is charged once per part
  (sub-order); a seller-fault partial return refunds shipping in proportion to the
  goods value returned.

## Phase 1 — Foundations

Status: done — PR navneetpatel-dev/ecommerce-backend#33, navneetpatel-dev/ecommerce-web#20 (migration `20260929000001` backfills HSN and rate on existing invoices).

- [x] **#6** Report ranges are IST days (backend parses `YYYY-MM-DD` as IST; web
      default range uses IST dates).
- [x] **#8** One HSN resolver (product HSN, else nearest category rule up the tree);
      HSN and GST rate frozen on every invoice snapshot line at checkout.

## Phase 2 — GST filing reports

Status: done. Every GST report reads one source (`reports/engine/gstDocumentsSql.ts`):
invoices as issued plus credit notes, dated by the document.

- [x] **#1** GSTR-1, tax invoice registers (admin + vendor) and B2B register read the
      invoice as issued (snapshot); returns only through credit notes.
- [x] **#2** CGST / SGST / IGST filled in every GSTR-1 section.
- [x] **#10** GSTR-1 rows per rate; B2CL split; CDN rows carry recipient GSTIN, state
      and tax split.
- [x] **#3** GSTR-3B from invoices issued in the period less credit notes issued in
      the period; TCS on its own line, not added to output tax.
- [x] **#4** Commission invoices / credit notes (SAC 9985) in GSTR-1, HSN summary and
      GSTR-3B.
- [x] **#7** HSN summary and state-wise tax by invoice date and credit-note date.
- [x] **#32** Credit/debit note register: taxable value, tax split, place of supply,
      recipient GSTIN.
- [x] **#9** Tax invoice PDF shows GST rate and discount per line.
- [x] **#13** Vendor TCS credit report uses the GSTR-8 rule (keeps RTO'd orders).
- [x] **#26** TCS return adjustment dated with the vendor credit note.
- [x] **#37** TCS split by place of supply (not by whether GST was charged); no TCS on
      nil-rated lines.

## Phase 3 — Reconciliation, settlement, payouts, TDS

Status: done (migration `20260929000002` adds the payout breakdown columns and allows
order-less 194-O catch-up rows).

- [x] **#5** Reconciliation identity balances (no double GST, platform coupon and gift
      wrap accounted, vendor filter scoped to the vendor's parts).
- [x] **#11** Vendor summary / settlement "upcoming" = the payout breakdown (after TDS
      and commission GST).
- [x] **#12** Settlement payout totals exclude FAILED payouts.
- [x] **#21** Ledger-based reports exclude unpaid online checkouts.
- [x] **#14** Commission revenue: IST months, per-line category, paid/COD only.
- [x] **#15** 194-O TDS period = payout (deduction) date.
- [x] **#16** 194-O catch-up after the exemption limit is crossed.
- [x] **#17** Payout stores gross, commission, commission GST, TDS, adjustments.
- [x] **#24** Returns after payout get a commission credit note, not netted into the
      next invoice.
- [x] **#25** Commission credit-note PDF shows negative IGST.
- [x] **#27** Delivery-agent 194C TDS report.

## Phase 4 — Pricing and refund policy

Status: done (migration `20260929000003` adds the supply value and its GST to items,
parts, sale ledgers and returns; older rows fall back to the taxable value).

- [x] **#18** Platform-funded coupon: GST/TCS/194-O on the value before the platform's
      share; platform pays the extra GST (engine `supplyTaxablePaise`, `supplyTax`,
      `platformGstSubsidyPaise`; the vendor invoice and credit note carry the supply
      value, the customer's total is unchanged).
- [x] **#39** Return fee once per part; pro-rata shipping refund on seller-fault
      partial returns (the last return refunds the rest).
- [x] **#38** Refund recorded = wallet + card actually refunded (split in paise; the
      kept return fee no longer read from the recorded refund).
- [x] **#42** TCS rate taken at dispatch (the part, its items and unpaid sale ledger
      are re-rated when the rate changed), 194-O rate at payout (stamped on the sale
      for later return reversals; a sale exempt at checkout stays exempt).

## Phase 5 — Analytics and ops reports

Status: done (migration `20260929000004` adds `sub_orders.cancelledAt`,
`order_items.categoryId` and `gift_cards.paidAt`, each backfilled).

- [x] **#19** Vendor sales, vendor GST sales, product/category performance exclude
      cancelled and RTO'd parts.
- [x] **#20** One meaning per label: GMV (before discount) vs net sales (after discount);
      dashboards say GMV, the performance reports show both.
- [x] **#22** Coupon cost: vendor vs platform share per ledger (a stacked order carries
      both), the GST the platform pays on its share, free-shipping cost; labelled
      excl. GST. Reconciliation and vendor summary use the same split.
- [x] **#23** Coupon "discount given" net of returns (over each part's discount at
      checkout).
- [x] **#28** Admin cancellation / return rates on placed orders: cancelled parts over
      placed parts; delivered parts with an accepted return over delivered parts.
- [x] **#29** Platform analytics return count and rate (same helper,
      `reports/engine/orderRates.ts`).
- [x] **#30** Wallet liability total includes every balance as of the range end.
- [x] **#31** Cancellations report: one row per cancelled part, amount incl. GST and
      shipping, real cancel time (`cancelledAt`), placed orders only.
- [x] **#33** Fulfilment SLA from the shipment's delivered time (admin, vendor report,
      vendor dashboard).
- [x] **#34** Customer segment by lifetime orders.
- [x] **#35** Customer order history: GST-inclusive coupon savings (as the order page).
- [x] **#36** Vendor GST sales tax split equals the tax (phase 2: read from the invoice
      and credit-note lines as issued).
- [x] **#40** Abandoned cart value GST-inclusive.
- [x] **#41** Gift cards sold by paid date (`paidAt`).
- [x] **#43** Top-vendor / top-category share of the whole platform GMV; top categories
      and category reports by the category each line was sold under.

## Notes

- The return fee stays platform income when a vendor overrides its amount: the platform
  runs the reverse pickup; the vendor setting only sets the fee (#39).
- Deploy: run migrations `20260929000001` to `20260929000004` in order.
