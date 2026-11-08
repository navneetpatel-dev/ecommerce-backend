// Coupon end-to-end audit: drives a running backend as admin, vendor and customer and checks
// every finding from the 2026-11-08 coupon audit. Run it against a THROWAWAY database only:
//   E2E_BASE_URL=http://127.0.0.1:19099 PGPORT=55433 PGDATABASE=coupon_audit node scripts/e2e-calc-verification/scenarios/07-coupon-audit.mjs
import { execFileSync } from 'node:child_process';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:19099';
const sql = (q) =>
  execFileSync('psql', ['-h', process.env.PGHOST ?? '127.0.0.1', '-p', process.env.PGPORT ?? '55433', '-U', process.env.PGUSER ?? 'postgres', '-d', process.env.PGDATABASE ?? 'coupon_audit', '-At', '-F', '|', '-c', q], { encoding: 'utf8' }).trim();
const rows = (q) => { const o = sql(q); return o ? o.split('\n').map((l) => l.split('|')) : []; };
async function api(method, path, token, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, data: json?.data, raw: json, code: json?.error?.code, msg: json?.error?.message };
}
const G = (p, t) => api('GET', p, t); const P = (p, t, b) => api('POST', p, t, b); const PA = (p, t, b) => api('PATCH', p, t, b); const D = (p, t) => api('DELETE', p, t);
let pass = 0; const failed = [];
const check = (id, what, ok, seen) => { if (ok) pass += 1; else failed.push(`#${id} ${what} :: ${JSON.stringify(seen)}`); console.log(`${ok ? 'PASS' : 'FAIL'} #${id} ${what}${ok ? '' : ' :: ' + JSON.stringify(seen)}`); };
const login = async (email) => { const r = await P('/api/auth/login', null, { email, password: 'Test@123' }); if (!r.data?.accessToken) throw new Error(`login ${email} ${r.status}`); return r.data.accessToken; };
const run = 'E' + Date.now().toString(36).toUpperCase().slice(-5);
const code = (s) => run + s;
const now = Date.now();
const w = { startDate: new Date(now - 3600e3).toISOString(), endDate: new Date(now + 7 * 864e5).toISOString() };

const [vA, vB] = rows(`select v.id, u.email from vendors v join users u on u."vendorId"=v.id join roles r on r.id=u."roleId" where v.status='APPROVED' and v."kycVerified"=true and r.name='VENDOR_OWNER' and (select count(*) from products p join product_variants pv on pv."productId"=p.id where p."vendorId"=v.id and p.status='LIVE' and p."categoryId" is not null and pv.price between 300 and 3000) >= 3 order by v."businessName" limit 2`).map(([id, email]) => ({ id, email }));
const picks = (id, n) => rows(`select distinct on (p.id) pv.id, p.id from product_variants pv join products p on p.id=pv."productId" where p."vendorId"='${id}' and p.status='LIVE' and p."categoryId" is not null and pv.price between 300 and 3000 order by p.id, pv.price limit ${n}`).map(([variantId, productId]) => ({ variantId, productId }));
const [a1, a2, cheap] = picks(vA.id, 3); const [b1] = picks(vB.id, 1);
sql(`update product_variants set stock=5000 where id in ('${a1.variantId}','${a2.variantId}','${cheap.variantId}','${b1.variantId}')`);
sql(`update product_variants set price=300 where id='${cheap.variantId}'`);
sql(`update coupons set status='PAUSED' where status='ACTIVE' and code not like 'E%'`);
const admin = await login('catalogmanager@ecommerce.com');
const ownerA = await login(vA.email);
const staffA = await login(sql(`select u.email from users u join roles r on r.id=u."roleId" where r.name='VENDOR_STAFF' and u."vendorId"='${vA.id}' limit 1`));
const emails = rows(`select u.email from users u join roles r on r.id=u."roleId" where r.name='CUSTOMER' and u.status='ACTIVE' and u."emailVerified"=true and not exists (select 1 from orders o where o."userId"=u.id and o."createdAt">now()-interval '30 minutes') order by random()`).map((r) => r[0]);
let ci = 0;
const cust = async () => {
  const email = emails[ci++]; const token = await login(email); const id = sql(`select id from users where email='${email}'`);
  await D('/api/coupons/remove', token); await D('/api/cart', token);
  let addr = (await G('/api/users/addresses', token)).data?.[0];
  if (!addr) addr = (await P('/api/users/addresses', token, { line1: '1 Audit St', city: 'Delhi', state: 'Delhi', pincode: '110001', lat: 28.6, lng: 77.2, isDefault: true })).data;
  return { email, token, id, addr };
};
const add = (c, v, q = 1) => P('/api/cart/items', c.token, { variantId: v.variantId, quantity: q });
const cart = async (c) => (await G('/api/cart', c.token)).data;
const apply = (c, cd) => P('/api/coupons/apply', c.token, { code: cd });
const quote = (c, x = {}) => P('/api/checkout/quote', c.token, { addressId: c.addr.id, ...x });
const cod = (c, x = {}) => P('/api/checkout', c.token, { addressId: c.addr.id, paymentMethod: 'COD', ...x });
const codesOf = (ct) => ({ couponCodes: (ct.appliedCoupons ?? []).map((x) => x.code) });
const adminC = (b) => P('/api/coupons', admin, { ...w, type: 'PERCENTAGE', value: 10, ...b });
const vendRaw = (b) => P('/api/coupons/vendor', ownerA, { ...w, type: 'PERCENTAGE', value: 10, applicableScope: { type: 'vendor', ids: [vA.id] }, ...b });
const vendLive = async (b) => { const r = await vendRaw(b); await PA(`/api/coupons/${r.data.id}/status`, admin, { status: 'ACTIVE' }); return r; };
const part = (orderId) => { const [r = []] = rows(`select s."discountAmountPaise",s."shippingCostPaise",s."shippingDiscountAmountPaise",s."netPayoutAmountPaise",o."totalAmount" from sub_orders s join orders o on o.id=s."orderId" where s."orderId"='${orderId}' limit 1`); return { discount: +r[0], shipCost: +r[1], shipDisc: +r[2], net: +r[3], total: +r[4] }; };
const usedCount = (cd) => Number(sql(`select "usedCount" from coupons where code='${cd}'`));

// --- Authority ---
{
  const bearer = await vendRaw({ code: code('BEAR'), type: 'FLAT', value: 100, discountBearer: 'PLATFORM' });
  check(1, 'vendor cannot choose platform as payer', bearer.data?.discountBearer === 'VENDOR', bearer.data?.discountBearer);
  check(14, 'new vendor coupon waits for approval', bearer.data?.status === 'PENDING_APPROVAL', bearer.data?.status);
  const c = await cust(); await add(c, a1);
  check(14, 'pending coupon cannot be redeemed', (await apply(c, bearer.data.code)).status === 422);
  const st = await vendRaw({ code: code('SELF'), status: 'ACTIVE' });
  check(14, 'vendor cannot pick status on create', st.data?.status === 'PENDING_APPROVAL', st.data?.status);

  const rej = await vendRaw({ code: code('MOD'), type: 'FLAT', value: 20 });
  const noNote = await PA(`/api/coupons/${rej.data.id}/status`, admin, { status: 'REJECTED' });
  check(19, 'rejecting needs a reason', noNote.status === 422, noNote.status);
  const done = await PA(`/api/coupons/${rej.data.id}/status`, admin, { status: 'REJECTED', note: 'Too generous' });
  check(19, 'rejection reason saved', done.data?.rejectionNote === 'Too generous', done.data?.rejectionNote);
  check(19, 'vendor owner notified of rejection', Number(sql(`select count(*) from notification_logs where type='COUPON_REJECTED' and "referenceId" like '${rej.data.id}%'`)) === 1);
  const back = await PA(`/api/coupons/vendor/${rej.data.id}/status`, ownerA, { status: 'ACTIVE' });
  check(2, 'vendor cannot reactivate a rejected coupon (status API)', back.status === 422, back.status);
  const back2 = await PA(`/api/coupons/vendor/${rej.data.id}`, ownerA, { status: 'ACTIVE' });
  check(2, 'general PATCH ignores status', (back2.data?.status ?? 'x') !== 'ACTIVE', back2.data?.status);
  const res = await PA(`/api/coupons/vendor/${rej.data.id}`, ownerA, { value: 5 });
  check(14, 'editing a rejected coupon resubmits it', res.data?.status === 'PENDING_APPROVAL', res.data?.status);

  const live = await vendLive({ code: code('LIVE'), type: 'FLAT', value: 30 });
  const ed = await PA(`/api/coupons/vendor/${live.data.id}`, ownerA, { value: 40 });
  check(14, 'changing an approved coupon needs re-approval', ed.data?.status === 'PENDING_APPROVAL', ed.data?.status);

  const admBear = await adminC({ code: code('ABEAR'), type: 'FLAT', value: 100, discountBearer: 'VENDOR' });
  check(4, 'admin coupon with no vendor is platform-funded', admBear.data?.discountBearer === 'PLATFORM', admBear.data?.discountBearer);

  const arch = await adminC({ code: code('ARCH') });
  await PA(`/api/coupons/${arch.data.id}/status`, admin, { status: 'ARCHIVED' });
  check(46, 'archived coupon cannot return to active', (await PA(`/api/coupons/${arch.data.id}/status`, admin, { status: 'ACTIVE' })).status === 422);

  check(15, 'edit rejects 500%', (await PA(`/api/coupons/${admBear.data.id}`, admin, { type: 'PERCENTAGE', value: 500 })).status === 422);
  const pct = await adminC({ code: code('PCT') });
  check(15, 'edit rejects 500% with no type sent', (await PA(`/api/coupons/${pct.data.id}`, admin, { value: 500 })).status === 422);
  check(15, 'edit rejects end before start', (await PA(`/api/coupons/${pct.data.id}`, admin, { endDate: new Date(now - 400 * 864e5).toISOString() })).status === 422);
  check(16, 'create rejects 0%', (await adminC({ code: code('ZERO'), value: 0 })).status === 422);
  check(16, 'create rejects an ended coupon', (await adminC({ code: code('PAST'), startDate: new Date(now - 9 * 864e5).toISOString(), endDate: new Date(now - 8 * 864e5).toISOString() })).status === 422);
  check(17, 'empty specific-user list rejected', (await adminC({ code: code('SP0'), userRestriction: { type: 'specific', value: [] } })).status === 422);
  sql(`insert into coupons (id,code,type,value,"applicableScope","excludedItems","userRestriction",config,"startDate","endDate",status,"discountBearer","createdById","createdAt","updatedAt") select gen_random_uuid(),'${code('SPOLD')}','FLAT',10,'{"type":"all","ids":[]}','{}','{"type":"specific","value":[]}','{}',now()-interval '1 day',now()+interval '1 day','ACTIVE','PLATFORM',"createdById",now(),now() from coupons limit 1`);
  check(17, 'old empty-list coupon rejects everyone', (await apply(c, code('SPOLD'))).status === 422);
  const dup = await adminC({ code: code('PCT').toLowerCase() });
  check(18, 'duplicate code is a clear 409', dup.status === 409 && dup.code === 'COUPON_CODE_TAKEN', [dup.status, dup.code]);
  check(43, 'code characters are restricted', (await adminC({ code: run + ' 10% OFF!' })).status === 422);
  const a = await apply(c, 'NOPE' + run); const pa = await adminC({ code: code('PAU') });
  await PA(`/api/coupons/${pa.data.id}/status`, admin, { status: 'PAUSED' });
  const b = await apply(c, pa.data.code);
  check(34, 'unknown and paused codes answer the same', a.msg === b.msg && a.code === b.code, [a.msg, b.msg]);
  const per = await adminC({ code: code('PER0'), usageLimitPerUser: null });
  check(27, 'explicit blank per-user limit stays unlimited', per.data?.usageLimitPerUser === null, per.data?.usageLimitPerUser);
  const bulk = await P('/api/coupons/bulk', admin, { name: 'audit-' + run, count: 3, prefix: 'AU', template: { ...w, type: 'FLAT', value: 30, usageLimitTotal: 50 } });
  const codes = bulk.data?.coupons?.map((x) => x.code) ?? [];
  check(26, 'bulk codes are single-use', bulk.data?.coupons?.every((x) => x.usageLimitTotal === 1), bulk.status);
  check(45, 'bulk codes are long and non-confusable', codes.every((x) => /^AU[2-9A-HJKMNP-Z]{10}$/.test(x)), codes);
  const pausedB = await PA(`/api/coupons/batches/${bulk.data.batch.id}/status`, admin, { status: 'PAUSED' });
  check(44, 'batch can be paused', pausedB.data?.updated === 3, pausedB.data);
  await PA(`/api/coupons/batches/${bulk.data.batch.id}/status`, admin, { status: 'ACTIVE' });
  const list = await G(`/api/coupons?search=${run}PC&excludeBatches=true&limit=50`, admin);
  check(21, 'search by code works', list.data?.length === 1 && list.data[0].code === code('PCT'), list.data?.map((x) => x.code));
  const noBatches = await G('/api/coupons?excludeBatches=true&vendorScoped=false&limit=100', admin);
  check(21, 'batch codes can be left out', !noBatches.data?.some((x) => x.batchId), noBatches.status);
  const vt = await G('/api/coupons?vendorScoped=true&limit=5', admin);
  check(20, 'vendor name in admin list', Boolean(vt.data?.[0]?.vendorName), vt.data?.[0]?.vendorName);
  check(29, 'vendor staff still blocked from creating', (await P('/api/coupons/vendor', staffA, { ...w, code: code('STF'), type: 'FLAT', value: 1 })).status === 403);
  check(29, 'vendor staff can read', (await G('/api/coupons/vendor', staffA)).status === 200);
}

// --- Offers ---
{
  const spec = await adminC({ code: code('PRIV'), priority: 100, type: 'FLAT', value: 500, userRestriction: { type: 'specific', value: ['00000000-0000-4000-8000-000000000000'] } });
  const seg = await adminC({ code: code('LOY'), priority: 99, userRestriction: { type: 'segment', value: 'loyal' }, showInOffers: true });
  const hidden = await adminC({ code: code('HID'), priority: 98, showInOffers: false });
  const pub = await adminC({ code: code('PUB'), priority: 97 });
  const bulk = await P('/api/coupons/bulk', admin, { name: 'leak-' + run, count: 2, prefix: 'SC', template: { ...w, priority: 96, type: 'FLAT', value: 25 } });
  const list = (await G(`/api/coupons/eligible-public?productId=${a1.productId}&limit=20`)).data?.map((x) => x.code) ?? [];
  check(3, 'specific-user code not public', !list.includes(spec.data.code), list);
  check(3, 'segment code not public', !list.includes(seg.data.code), list);
  check(3, 'hidden code not public', !list.includes(hidden.data.code), list);
  check(3, 'bulk codes not public', !bulk.data.coupons.some((x) => list.includes(x.code)), list);
  check(3, 'public coupon still listed', list.includes(pub.data.code), list);
  const c = await cust(); await add(c, a1);
  check(3, 'hidden code still works when typed', (await apply(c, hidden.data.code)).status === 200);
  await D('/api/coupons/remove', c.token);
  const real = await adminC({ code: code('REAL'), type: 'FLAT', value: 40 });
  await P('/api/coupons/bulk', admin, { name: 'crowd-' + run, count: 55, prefix: 'CR', template: { ...w, type: 'FLAT', value: 1, applicableScope: { type: 'product', ids: [a1.productId] } } });
  for (let i = 0; i < 55; i += 1) await adminC({ code: code('OTH' + i), type: 'FLAT', value: 1, applicableScope: { type: 'product', ids: [a1.productId] } });
  const after = (await G(`/api/coupons/eligible-public?productId=${b1.productId}&limit=20`)).data?.map((x) => x.code) ?? [];
  check(11, 'real offer survives 110 newer unrelated coupons', after.includes(real.data.code), after);
  const c2 = await cust(); await add(c2, b1);
  const NS = await adminC({ code: code('NSA'), type: 'FLAT', value: 10 });
  await apply(c2, NS.data.code);
  const off = (await G('/api/coupons/eligible?limit=20', c2.token)).data ?? [];
  check(23, 'offer says what it would replace', off.find((x) => x.code === real.data.code)?.replaces?.includes(NS.data.code), off[0]);
  const swap = await apply(c2, real.data.code);
  check(23, 'applying another coupon replaces it', swap.status === 200 && swap.data?.replacedCodes?.includes(NS.data.code) && swap.data?.codes?.length === 1, swap.data);
  const bad = await apply(c2, 'NOPE' + run);
  const still = await cart(c2);
  check(23, 'a bad code leaves the current coupon on', bad.status === 422 && still.appliedCoupons?.[0]?.code === real.data.code, still.appliedCoupons);
  const twoV = rows(`select v.id from product_variants v where v."productId"='${a1.productId}' order by v.price desc limit 1`)[0]?.[0];
  const pdp = await G(`/api/coupons/eligible-public?productId=${a1.productId}&variantId=${twoV}&limit=3`);
  check(42, 'offers accept the selected variant', pdp.status === 200, pdp.status);
}

// --- Money ---
{
  const place = async (cd, v = a1) => {
    const c = await cust(); await add(c, v);
    if (cd) { const r = await apply(c, cd); if (r.status !== 200) console.log('apply failed', cd, r.msg); }
    const o = await cod(c, codesOf(await cart(c)));
    if (o.status !== 201) console.log('order failed', cd, o.msg);
    return { ...part(o.data?.orderId), orderId: o.data?.orderId };
  };
  const none = await place(null);
  const own = await vendLive({ code: code('VOWN'), type: 'FLAT', value: 100 });
  const ownO = await place(own.data.code);
  check(1, 'vendor coupon reduces the vendor payout', ownO.net < none.net, [none.net, ownO.net]);

  const c = await cust(); await add(c, a1); await add(c, a2);
  const sc = await vendLive({ code: code('SCOPE'), type: 'FLAT', value: 200, applicableScope: { type: 'product', ids: [a1.productId] } });
  await apply(c, sc.data.code);
  const ct = await cart(c); const q = await quote(c, codesOf(ct));
  const o = await cod(c, { ...codesOf(ct), expectedGrandTotal: q.data?.grandTotal });
  const lines = rows(`select oi."variantId"='${a1.variantId}', oi."discountAmountPaise" from order_items oi join sub_orders s on s.id=oi."subOrderId" where s."orderId"='${o.data?.orderId}'`);
  check(5, 'scoped discount only on the scoped product', lines.find((l) => l[0] === 't')?.[1] > 0 && Number(lines.find((l) => l[0] === 'f')?.[1]) === 0, lines);
  check(5, 'cart, quote and order agree', ct.pricingPreview.grandTotal === q.data?.grandTotal && part(o.data.orderId).total === q.data?.grandTotal, [ct.pricingPreview.grandTotal, q.data?.grandTotal, part(o.data.orderId).total]);
  check(5, 'customer saves exactly the coupon amount', ct.pricingPreview.couponSavings === 200, ct.pricingPreview.couponSavings);

  const c4 = await cust(); await add(c4, a1); await add(c4, b1);
  const plat = await adminC({ code: code('STP'), stackable: true }); const ven = await vendLive({ code: code('STV'), type: 'FLAT', value: 50, stackable: true });
  await apply(c4, plat.data.code); const st = await apply(c4, ven.data.code);
  const stc = await cart(c4); const stq = await quote(c4, codesOf(stc));
  check(5, 'stacked: cart and quote agree', st.status === 200 && stc.pricingPreview.grandTotal === stq.data?.grandTotal, [stc.pricingPreview.grandTotal, stq.data?.grandTotal]);

  const base = await place(null, cheap);
  const ship = await vendLive({ code: code('VSHIP'), type: 'FREE_SHIPPING' });
  const before = (await G('/api/coupons/vendor/absorbed-summary', ownerA)).data.absorbedDiscountTotal;
  const so = await place(ship.data.code, cheap);
  const row = rows(`select cl."netPayoutAmountPaise",cl."referenceType",cl.status from commission_ledgers cl join sub_orders s on s.id=cl."subOrderId" where s."orderId"='${so.orderId}' and cl."referenceType"='ShippingCouponCost'`)[0];
  check(7, 'vendor charged the waived shipping', base.shipCost > 0 && Number(row?.[0]) === -so.shipDisc && so.shipDisc > 0, [base.shipCost, so.shipDisc, row]);
  const after = (await G('/api/coupons/vendor/absorbed-summary', ownerA)).data.absorbedDiscountTotal;
  check(7, 'absorbed total reflects a cost they really pay', after > before, [before, after]);

  const c5 = await cust(); await add(c5, a1);
  const bogo = await adminC({ code: code('BOGO'), type: 'BOGO', value: null });
  const bg = await apply(c5, bogo.data.code);
  check(10, 'BOGO at one unit rejected with a message', bg.status === 422 && /another/i.test(bg.msg), [bg.status, bg.msg]);
  const tier = await adminC({ code: code('TIER'), type: 'TIERED', value: null, config: { tiers: [{ minSubtotal: 9999999, percent: 10 }] } });
  check(10, 'tier not reached rejected', (await apply(c5, tier.data.code)).status === 422);
  const fs = await adminC({ code: code('FS'), type: 'FREE_SHIPPING' });
  const fo = await cod(c5, { couponCodes: [fs.data.code] });
  check(10, 'no use spent when shipping was already free', fo.status === 201 && usedCount(fs.data.code) === 0, [fo.status, usedCount(fs.data.code)]);

  const c6 = await cust(); await add(c6, a1); await add(c6, b1);
  const vp = await vendLive({ code: code('VPART'), type: 'FLAT', value: 20, stackable: true });
  const op = await cod(c6, { couponCodes: [vp.data.code] });
  const aPart = sql(`select id from sub_orders where "orderId"='${op.data.orderId}' and "vendorId"='${vA.id}'`);
  const cancelPart = await PA(`/api/suborders/${aPart}/status`, ownerA, { status: 'CANCELLED' });
  check(37, 'use returned when the coupon vendor part is cancelled', cancelPart.status === 200 && usedCount(vp.data.code) === 0, [cancelPart.status, cancelPart.msg, usedCount(vp.data.code)]);

  // Cashback: two payers on one order
  const c7 = await cust(); await add(c7, a1); await add(c7, b1);
  const pcb = await adminC({ code: code('CBP'), type: 'CASHBACK', value: 75, stackable: true });
  const vcb = await vendLive({ code: code('CBV'), type: 'CASHBACK', value: 50, stackable: true });
  await apply(c7, pcb.data.code); await apply(c7, vcb.data.code);
  const cc = await cart(c7);
  check(8, 'cashback named in rupees', cc.appliedCoupons?.some((x) => x.name === '₹75 cashback'), cc.appliedCoupons);
  const oc = await cod(c7, codesOf(cc));
  const bd = JSON.parse(sql(`select "cashbackBreakdown" from orders where id='${oc.data.orderId}'`) || '[]');
  check(6, 'each cashback coupon keeps its own payer', bd.some((e) => e.bearer === 'PLATFORM' && e.amountPaise === 7500) && bd.some((e) => e.bearer === 'VENDOR' && e.amountPaise === 5000 && e.vendorId === vA.id), bd);
  const bundleName = await adminC({ code: code('BND'), type: 'BUNDLE', value: 40, config: { bundleProductIds: [a1.productId, a2.productId] }, applicableScope: { type: 'product', ids: [a1.productId, a2.productId] } });
  const c8 = await cust(); await add(c8, a1); await add(c8, a2); await apply(c8, bundleName.data.code);
  check(39, 'bundle name hides the raw code', (await cart(c8)).appliedCoupons?.[0]?.name === '₹40 off bundle');
  const ana = await G(`/api/coupons/${vcb.data.id}/analytics`, admin);
  check(30, 'analytics replace conversion rate', ana.data?.limitUsedPercent === null && !('conversionRate' in (ana.data ?? {})) && 'cashbackTotal' in (ana.data ?? {}) && 'customerSavings' in (ana.data ?? {}), ana.data);
}

// --- Cart and checkout state ---
{
  const c = await cust(); await add(c, a1);
  const k = await adminC({ code: code('DIE') }); await apply(c, k.data.code);
  await PA(`/api/coupons/${k.data.id}/status`, admin, { status: 'PAUSED' });
  const q1 = await quote(c, { couponCodes: [k.data.code] });
  check(9, 'a stale code fails with a coupon error code', q1.status === 422 && String(q1.code).startsWith('COUPON_'), [q1.status, q1.code]);
  const c1 = await cart(c); const c2 = await cart(c);
  check(9, 'reason shows on every load, not just once', c1.inactiveCoupons?.[0]?.reason && c2.inactiveCoupons?.[0]?.reason, c2.inactiveCoupons);
  const q2 = await quote(c, codesOf(c2));
  check(9, 'quote works once the cart drops it', q2.status === 200, q2.status);
  const qOld = await quote(c);
  check(9, 'older client (no codes) is not blocked', qOld.status === 200, qOld.status);
  await PA(`/api/coupons/${k.data.id}/status`, admin, { status: 'ACTIVE' });
  check(25, 'coupon reapplies when it can', (await cart(c)).appliedCoupons?.[0]?.code === k.data.code);

  const c3 = await cust(); await add(c3, a1, 5);
  const mq = await adminC({ code: code('MQ'), type: 'FLAT', value: 50, minQuantity: 3 }); await apply(c3, mq.data.code);
  const ci3 = await cart(c3);
  await PA(`/api/cart/items/${ci3.items[0].id}`, c3.token, { quantity: 1 });
  check(25, 'quantity drop parks the coupon with a reason', (await cart(c3)).inactiveCoupons?.[0]?.code === mq.data.code);
  await PA(`/api/cart/items/${ci3.items[0].id}`, c3.token, { quantity: 5 });
  check(25, 'quantity back restores it', (await cart(c3)).appliedCoupons?.[0]?.code === mq.data.code);

  const c4 = await cust(); await add(c4, a1);
  const s1 = await adminC({ code: code('ST1'), stackable: true }); const s2 = await vendLive({ code: code('ST2'), type: 'FLAT', value: 10, stackable: true });
  await apply(c4, s1.data.code); await apply(c4, s2.data.code);
  await PA(`/api/coupons/${s1.data.id}/status`, admin, { status: 'PAUSED' });
  const mix = await cart(c4);
  check(25, 'one bad coupon leaves the other applied', mix.appliedCoupons?.length === 1 && mix.appliedCoupons[0].code === s2.data.code && mix.inactiveCoupons?.[0]?.code === s1.data.code, mix.appliedCoupons);
  const rm = await D(`/api/coupons/remove?code=${s1.data.code}`, c4.token);
  check(25, 'removing one keeps the other', rm.data?.appliedCoupons?.[0]?.code === s2.data.code, rm.data);

  const c5 = await cust(); await add(c5, a1);
  const cl = await adminC({ code: code('CLR') }); await apply(c5, cl.data.code);
  await D('/api/cart', c5.token);
  const em = await cart(c5);
  check(41, 'clear cart removes the coupon, no message', !em.removedCouponReason && sql(`select "couponCodes" from carts where "userId"='${c5.id}'`) === '[]', em.removedCouponReason);

  const c6 = await cust(); await add(c6, a1);
  const g = await adminC({ code: code('GATE'), usageLimitTotal: 3 }); await apply(c6, g.data.code);
  const gf = await P('/api/checkout', c6.token, { addressId: c6.addr.id, paymentMethod: 'RAZORPAY', ...codesOf(await cart(c6)) });
  const ga = await cart(c6);
  check(24, 'failed payment returns items and coupon', gf.status >= 500 && ga.items?.length === 1 && ga.appliedCoupons?.[0]?.code === g.data.code && usedCount(g.data.code) === 0, [gf.status, ga.items?.length, ga.appliedCoupons]);

  const c7 = await cust(); await add(c7, a1);
  const u = await adminC({ code: code('USED') }); await apply(c7, u.data.code);
  const qs = await quote(c7, codesOf(await cart(c7)));
  const po = await cod(c7, { couponCodes: [u.data.code], expectedGrandTotal: qs.data?.grandTotal });
  const ord = await G(`/api/orders/${po.data.orderId}`, c7.token);
  check(40, 'order shows the coupon used', ord.data?.appliedCoupons?.[0]?.name === '10% off', ord.data?.appliedCoupons);
  check(1, 'used count goes up', usedCount(u.data.code) === 1);
  await add(c7, a1);
  check(0, 'per-user limit holds', (await apply(c7, u.data.code)).status === 422);
  await D('/api/cart', c7.token);
  await P(`/api/orders/${po.data.orderId}/cancel`, c7.token, {});
  check(0, 'cancel returns the use', usedCount(u.data.code) === 0);
  check(40, 'cancelled order still shows the coupon', (await G(`/api/orders/${po.data.orderId}`, c7.token)).data?.appliedCoupons?.length === 1);
  const ed = await PA(`/api/coupons/${u.data.id}`, admin, { code: code('USED2') });
  check(12, 'unused coupon can be renamed', ed.status === 200, ed.status);
  const c9 = await cust(); await add(c9, a1); await cod(c9, { couponCodes: [code('USED2')] });
  check(12, 'used coupon keeps its code', (await PA(`/api/coupons/${u.data.id}`, admin, { code: code('USED3') })).status === 422);

  const first = await adminC({ code: code('FST'), userRestriction: { type: 'firstOrder' } });
  const c10 = await cust(); sql(`delete from coupon_usages where "orderId" in (select id from orders where "userId"='${c10.id}')`);
  sql(`update orders set status='CANCELLED' where "userId"='${c10.id}'`);
  await add(c10, a1);
  const fa = await apply(c10, first.data.code);
  check(36, 'cancelled orders do not block first-order coupons', fa.status === 200, fa.msg);
  sql(`update orders set status='CANCELLED',"paymentStatus"='PAID' where "userId"='${c10.id}'`);
  const fb = await apply(c10, first.data.code);
  check(36, 'cancelled, refund pending does not block either', fb.status === 200, fb.msg);
  await cod(c10, { couponCodes: [] });
  await add(c10, a1);
  check(36, 'a live order blocks first-order coupons', (await apply(c10, first.data.code)).status === 422);
}

// --- Limits under load ---
{
  const k = await adminC({ code: code('RACE'), usageLimitTotal: 1 });
  const cs = await Promise.all([cust(), cust(), cust(), cust()]);
  for (const c of cs) await add(c, a1);
  const res = await Promise.all(cs.map((c) => cod(c, { couponCodes: [k.data.code] })));
  check(0, 'limit 1 under 4 parallel orders', res.filter((r) => r.status === 201).length === 1 && usedCount(k.data.code) === 1, res.map((r) => r.status));
}

// --- Jobs ---
{
  const ending = new Date(now + 864e5).toISOString();
  const pExp = await adminC({ code: code('EXP'), endDate: ending });
  const vExp = await vendLive({ code: code('EXV'), endDate: ending });
  const user = await cust(); sql(`update users set "emailMarketingConsent"=true where id='${user.id}'`);
  await add(user, a1); await apply(user, pExp.data.code);
  await cod(user, codesOf(await cart(user)));
  const holder = await cust(); sql(`update users set "emailMarketingConsent"=true where id='${holder.id}'`);
  await add(holder, a1);
  const st = await adminC({ code: code('EX2'), endDate: ending, stackable: true }); const st2 = await vendLive({ code: code('EX3'), type: 'FLAT', value: 5, stackable: true });
  await apply(holder, st2.data.code); await apply(holder, st.data.code);
  const job = await P('/api/coupons/jobs/notify-alerts', admin, {});
  check(38, 'alert job runs', job.status === 200, job.status);
  check(28, 'customer at their limit is not told to use it', Number(sql(`select count(*) from notification_logs where "userId"='${user.id}' and type='COUPON_OFFER_EXPIRING' and "referenceId" like '${pExp.data.id}%'`)) === 0);
  const ownerRole = sql(`select ro.name from notification_logs n join users u on u.id=n."userId" join roles ro on ro.id=u."roleId" where n."referenceId" like '${vExp.data.id}%' limit 1`);
  check(38, 'vendor alert goes to the owner', ownerRole === 'VENDOR_OWNER', ownerRole);
  check(38, 'platform alerts reach admins', Number(sql(`select count(*) from notification_logs n where n."referenceId" like '${pExp.data.id}%' and n.type='COUPON_EXPIRING'`)) > 0);
  check(38, 'stacked cart holder is alerted', Number(sql(`select count(*) from notification_logs where "userId"='${holder.id}' and type='COUPON_OFFER_EXPIRING'`)) > 0);
}

console.log(`\n${pass} passed, ${failed.length} failed`);
for (const f of failed) console.log('  ' + f);
process.exit(failed.length ? 1 : 0);
