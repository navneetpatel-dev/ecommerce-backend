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

- [ ] **#5** Reconciliation identity balances (no double GST, platform coupon and gift
      wrap accounted, vendor filter scoped to the vendor's parts).
- [ ] **#11** Vendor summary / settlement "upcoming" = the payout breakdown (after TDS
      and commission GST).
- [ ] **#12** Settlement payout totals exclude FAILED payouts.
- [ ] **#21** Ledger-based reports exclude unpaid online checkouts.
- [ ] **#14** Commission revenue: IST months, per-line category, paid/COD only.
- [ ] **#15** 194-O TDS period = payout (deduction) date.
- [ ] **#16** 194-O catch-up after the exemption limit is crossed.
- [ ] **#17** Payout stores gross, commission, commission GST, TDS, adjustments.
- [ ] **#24** Returns after payout get a commission credit note, not netted into the
      next invoice.
- [ ] **#25** Commission credit-note PDF shows negative IGST.
- [ ] **#27** Delivery-agent 194C TDS report.

## Phase 4 — Pricing and refund policy

- [ ] **#18** Platform-funded coupon: GST/TCS/194-O on the value before the platform's
      share; platform pays the extra GST.
- [ ] **#39** Return fee once per part; pro-rata shipping refund on seller-fault
      partial returns.
- [ ] **#38** Refund recorded = wallet + card actually refunded.
- [ ] **#42** TCS rate taken at dispatch, 194-O rate at payout.

## Phase 5 — Analytics and ops reports

- [ ] **#19** Vendor sales, vendor GST sales, product/category performance exclude
      cancelled and RTO'd parts.
- [ ] **#20** One meaning per label: GMV (before discount) vs net sales (after discount).
- [ ] **#22** Coupon cost: vendor vs platform share per ledger, free-shipping cost,
      GST-inclusive basis labelled.
- [ ] **#23** Coupon "discount given" net of returns.
- [ ] **#28** Admin cancellation / return rates on placed orders.
- [ ] **#29** Platform analytics return count.
- [ ] **#30** Wallet liability total includes every balance.
- [ ] **#31** Cancellations report: no double counting, one amount basis, real
      cancel time.
- [ ] **#33** Fulfilment SLA from the shipment's delivered time.
- [ ] **#34** Customer segment by lifetime orders.
- [ ] **#35** Customer order history: GST-inclusive coupon savings.
- [x] **#36** Vendor GST sales tax split equals the tax (phase 2: read from the invoice
      and credit-note lines as issued).
- [ ] **#40** Abandoned cart value GST-inclusive.
- [ ] **#41** Gift cards sold by paid date.
- [ ] **#43** Top-vendor share denominator; top categories by frozen category.
