/**
 * Support: PER_ACCOUNT support tickets and bug reports for every customer, vendor owner
 * and vendor staff login, each with a conversation (or comments), attachments, read
 * receipts, assignment and timings that match its status. Numbers continue the app's
 * TKT-/BUG- series.
 */
import { NOW, addDays, addHours, between, chance, exec, id, insert, int, minDate, pick, select, weighted, photo } from './lib';
import { scaled } from './scale';
import type { Accounts } from './accounts';

const PER_ACCOUNT = scaled(105, 3);

type Author = { id: string; role: 'CUSTOMER' | 'VENDOR' | 'VENDOR_STAFF'; vendorId: string | null; createdAt: Date };

const TICKET_TOPICS: Record<string, Array<[string, string]>> = {
  ORDER: [['Order not delivered yet', 'The tracking has not moved for three days.'], ['Wrong item received', 'I received a different variant from the one I ordered.']],
  PAYMENT: [['Charged twice', 'My card shows two debits for one order.'], ['Refund not received', 'The return was approved a week ago but no refund yet.']],
  PRODUCT: [['Missing accessories', 'The box did not include the charging cable.'], ['Product quality', 'The stitching came apart after one wash.']],
  VENDOR: [['Payout delayed', 'Last week\'s payout has not reached our bank account.'], ['Listing blocked', 'One of our products was rejected without a clear reason.']],
  OTHER: [['Account email change', 'I would like to change the email on my account.'], ['Feedback', 'The new app layout is great, thanks!']],
};
const BUG_TITLES = ['Checkout button unresponsive on mobile', 'Images fail to load in gallery', 'Coupon not applied though eligible', 'Order page shows wrong date', 'Filter resets after going back', 'Report export stuck at 99%', 'Search ignores brand filter', 'Wallet balance not refreshing'];
const MODULES = ['CATALOG', 'CART', 'CHECKOUT', 'PAYMENTS', 'ORDERS', 'VENDOR_DASHBOARD', 'ADMIN_DASHBOARD', 'OTHER'];

async function nextNumbers(kind: string, count: number): Promise<number> {
  const [row] = await select<{ nextValue: number }>('SELECT "nextValue" FROM document_sequences WHERE kind = :kind', { kind });
  const start = Math.max(Number(row?.nextValue ?? 1), 300_000);
  await exec('UPDATE document_sequences SET "nextValue" = :next WHERE kind = :kind', { kind, next: start + count });
  return start;
}

async function authors(accounts: Accounts): Promise<Author[]> {
  const vendorUsers = await select<{ id: string; role: string; vendorId: string; createdAt: Date }>(
    `SELECT u.id, r.name AS role, u."vendorId", u."createdAt" FROM users u JOIN roles r ON r.id = u."roleId"
     WHERE r.name IN ('VENDOR_OWNER', 'VENDOR_STAFF') AND u."vendorId" IN (:ids)`,
    { ids: accounts.sellingVendors.map((vendor) => vendor.id) },
  );
  return [
    ...accounts.customers.map((c) => ({ id: c.id, role: 'CUSTOMER' as const, vendorId: null, createdAt: c.createdAt })),
    ...vendorUsers.map((u) => ({ id: u.id, role: u.role === 'VENDOR_OWNER' ? ('VENDOR' as const) : ('VENDOR_STAFF' as const), vendorId: u.vendorId, createdAt: u.createdAt })),
  ];
}

async function seedTickets(accounts: Accounts, people: Author[], staff: Array<{ id: string; role: string }>) {
  const ordersByUser = new Map<string, string[]>();
  for (const row of await select<{ id: string; userId: string }>('SELECT id, "userId" FROM orders')) ordersByUser.set(row.userId, [...(ordersByUser.get(row.userId) ?? []), row.id]);
  let number = await nextNumbers('SUPPORT_TICKET', people.length * PER_ACCOUNT);
  const tickets: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const attachments: Array<Record<string, unknown>> = [];
  const reads: Array<Record<string, unknown>> = [];
  const flush = async () => {
    await insert('support_tickets', tickets.splice(0));
    await insert('ticket_messages', messages.splice(0));
    await insert('ticket_attachments', attachments.splice(0));
    await insert('ticket_reads', reads.splice(0));
  };
  for (const [index, person] of people.entries()) {
    for (let n = 0; n < PER_ACCOUNT; n += 1) {
      const at = between(addDays(person.createdAt, 5), addDays(NOW, -0.2));
      const ageDays = (NOW.getTime() - at.getTime()) / 86_400_000;
      const status = ageDays > 15 ? weighted([['CLOSED', 55], ['RESOLVED', 35], ['REOPENED', 5], ['IN_PROGRESS', 5]] as const) : weighted([['OPEN', 40], ['IN_PROGRESS', 35], ['RESOLVED', 15], ['REOPENED', 10]] as const);
      const category = person.role === 'CUSTOMER' ? pick(['ORDER', 'PAYMENT', 'PRODUCT', 'OTHER']) : pick(['VENDOR', 'PAYMENT', 'OTHER']);
      const [subject, description] = pick(TICKET_TOPICS[category]!);
      const agent = pick(staff);
      const responded = status !== 'OPEN' ? addHours(at, int(1, 30)) : null;
      const resolved = ['RESOLVED', 'CLOSED'].includes(status) ? minDate(addDays(at, int(1, 6)), NOW) : null;
      const ticketId = id();
      tickets.push({
        id: ticketId, ticketNumber: `TKT-${number++}`, customerId: person.id, subject, description, category,
        relatedOrderId: category === 'ORDER' || category === 'PAYMENT' ? (pick(ordersByUser.get(person.id) ?? [null as unknown as string]) ?? null) : null,
        relatedVendorId: person.vendorId, priority: weighted([['LOW', 25], ['MEDIUM', 45], ['HIGH', 22], ['URGENT', 8]] as const), status,
        assignedToId: status === 'OPEN' ? null : agent.id, firstResponseAt: responded, resolvedAt: resolved,
        closedAt: status === 'CLOSED' ? minDate(addDays(resolved!, 2), NOW) : null,
        customerSatisfactionRating: status === 'CLOSED' && chance(0.7) ? weighted([[5, 50], [4, 30], [3, 12], [2, 5], [1, 3]] as const) : null,
        createdAt: at, updatedAt: resolved ?? responded ?? at,
      });
      const turns = status === 'OPEN' ? 1 : int(2, 6);
      for (let t = 0; t < turns; t += 1) {
        const fromAgent = t % 2 === 1;
        const sentAt = minDate(addHours(at, t * int(2, 20)), NOW);
        const messageId = id();
        messages.push({
          id: messageId, ticketId, senderId: fromAgent ? agent.id : person.id, senderRole: fromAgent ? agent.role : person.role,
          body: t === 0 ? description : fromAgent ? pick(['Thanks for reaching out; we are looking into this.', 'We have escalated this to the seller.', 'This is now resolved. Please let us know if anything else is needed.']) : pick(['Any update on this?', 'Thank you, that worked.', 'Attaching a photo for reference.']),
          createdAt: sentAt, updatedAt: sentAt,
        });
        if (!fromAgent && chance(0.15)) {
          const video = chance(0.2);
          attachments.push({ id: id(), ticketId, messageId, url: video ? 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4' : photo(`tk-${messageId.slice(0, 8)}`), type: video ? 'VIDEO' : 'IMAGE', durationSeconds: video ? 5 : null, createdAt: sentAt, updatedAt: sentAt });
        }
      }
      reads.push({ id: id(), ticketId, userId: person.id, lastReadAt: chance(0.8) ? NOW : at, createdAt: at, updatedAt: at });
      if (status !== 'OPEN') reads.push({ id: id(), ticketId, userId: agent.id, lastReadAt: responded, createdAt: responded, updatedAt: responded });
    }
    if (index % 25 === 24) await flush();
  }
  await flush();
}

async function seedBugs(people: Author[], staff: Array<{ id: string; role: string }>) {
  let number = await nextNumbers('BUG_REPORT', people.length * PER_ACCOUNT);
  const bugs: Array<Record<string, unknown>> = [];
  const comments: Array<Record<string, unknown>> = [];
  const attachments: Array<Record<string, unknown>> = [];
  const flush = async () => {
    await insert('bug_reports', bugs.splice(0));
    await insert('bug_report_comments', comments.splice(0));
    await insert('bug_report_attachments', attachments.splice(0));
  };
  for (const [index, person] of people.entries()) {
    let previous: string | null = null;
    for (let n = 0; n < PER_ACCOUNT; n += 1) {
      const at = between(addDays(person.createdAt, 5), addDays(NOW, -0.2));
      const ageDays = (NOW.getTime() - at.getTime()) / 86_400_000;
      const status = ageDays > 30
        ? weighted([['FIXED', 25], ['VERIFIED', 15], ['CLOSED', 30], ['WONT_FIX', 12], ['DUPLICATE', 8], ['IN_PROGRESS', 10]] as const)
        : weighted([['NEW', 35], ['TRIAGED', 25], ['IN_PROGRESS', 25], ['FIXED', 15]] as const);
      const agent = pick(staff);
      const triaged = status === 'NEW' ? null : addHours(at, int(2, 48));
      const started = ['IN_PROGRESS', 'FIXED', 'VERIFIED', 'CLOSED'].includes(status) ? addDays(triaged!, 1) : null;
      const resolved = ['FIXED', 'VERIFIED', 'CLOSED', 'WONT_FIX', 'DUPLICATE'].includes(status) ? minDate(addDays(started ?? triaged!, int(1, 10)), NOW) : null;
      const bugId = id();
      const device = pick(['desktop', 'mobile', 'tablet']);
      bugs.push({
        id: bugId, reportNumber: `BUG-${number++}`, reporterId: person.id, reporterRole: person.role, userId: person.id,
        userRole: person.role === 'VENDOR' ? 'VENDOR_OWNER' : person.role, title: pick(BUG_TITLES),
        description: 'The page does not behave as expected. It happens every time on this account.',
        stepsToReproduce: '1. Open the page\n2. Perform the action\n3. Observe the problem', severity: weighted([['LOW', 30], ['MEDIUM', 40], ['HIGH', 22], ['CRITICAL', 8]] as const),
        status, duplicateOfId: status === 'DUPLICATE' ? previous : null, assignedToId: triaged ? agent.id : null,
        affectedModule: person.role === 'CUSTOMER' ? pick(MODULES.slice(0, 5)) : pick(['VENDOR_DASHBOARD', 'PAYMENTS', 'ORDERS', 'OTHER']),
        pageUrl: person.role === 'CUSTOMER' ? pick(['/checkout', '/cart', '/products', '/orders']) : pick(['/vendor/dashboard/orders', '/vendor/dashboard/products', '/vendor/dashboard/payouts']),
        userAgent: device === 'mobile' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0',
        browserName: pick(['Chrome', 'Safari', 'Firefox', 'Edge']), osName: device === 'mobile' ? pick(['iOS', 'Android']) : pick(['Windows', 'macOS']),
        deviceType: device, appVersion: `2.${int(0, 9)}.${int(0, 20)}`, occurredAt: addHours(at, -int(0, 5)),
        triagedAt: triaged, inProgressAt: started, resolvedAt: resolved, verifiedAt: status === 'VERIFIED' ? resolved : null,
        wontFixReason: status === 'WONT_FIX' ? 'Works as designed; the behaviour is documented in the help centre.' : null,
        createdAt: at, updatedAt: resolved ?? triaged ?? at,
      });
      if (status !== 'DUPLICATE') previous = bugId;
      for (let c = 0; c < (triaged ? int(1, 3) : 0); c += 1) {
        const commentAt = minDate(addHours(triaged!, c * 12), NOW);
        comments.push({ id: id(), bugReportId: bugId, authorId: c % 2 === 0 ? agent.id : person.id, body: c % 2 === 0 ? pick(['Thanks, we can reproduce this.', 'A fix is on its way in the next release.', 'Could you share a screenshot?']) : 'Sure, attached.', createdAt: commentAt, updatedAt: commentAt });
      }
      if (chance(0.25)) {
        const video = chance(0.25);
        attachments.push({ id: id(), bugReportId: bugId, url: video ? 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4' : photo(`bug-${bugId.slice(0, 8)}`), type: video ? 'SCREEN_RECORDING' : 'SCREENSHOT', durationSeconds: video ? 5 : null, createdAt: at, updatedAt: at });
      }
    }
    if (index % 25 === 24) await flush();
  }
  await flush();
}

export async function seedSupport(accounts: Accounts): Promise<void> {
  const people = await authors(accounts);
  const staff = await select<{ id: string; role: string }>(
    `SELECT u.id, r.name AS role FROM users u JOIN roles r ON r.id = u."roleId" WHERE r.name IN ('SUPER_ADMIN', 'ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER')`,
  );
  await seedTickets(accounts, people, staff);
  await seedBugs(people, staff);
  console.log(`  ${people.length} accounts × ${PER_ACCOUNT} tickets and bug reports`);
}
