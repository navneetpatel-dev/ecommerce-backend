import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { app } from '../../../app';
import { routes as router } from '../../../routes';
import {
  shortLinkCreateRateLimiter,
  webVitalsRateLimiter,
} from '@middleware/rateLimiter.middleware';

let server: Server;
let base = '';

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('email-provider webhooks are gone (SMTP is the only mail transport)', () => {
  for (const contentType of ['text/plain; charset=UTF-8', 'application/json']) {
    it(`POST /api/webhooks/ses answers 404 for ${contentType} bodies and processes nothing`, async () => {
      const res = await fetch(`${base}/api/webhooks/ses`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: JSON.stringify({ notificationType: 'Bounce', mail: { destination: ['victim@example.com'] } }),
      });
      assert.equal(res.status, 404);
    });
  }

  it('no other provider callback exists under /api/webhooks', async () => {
    for (const name of ['sns', 'sendgrid', 'mailgun', 'postmark', 'resend', 'ses/notifications']) {
      const res = await fetch(`${base}/api/webhooks/${name}`, { method: 'POST' });
      assert.equal(res.status, 404, `/api/webhooks/${name}`);
    }
  });

  it('Razorpay webhooks still demand a signature (unchanged)', async () => {
    const res = await fetch(`${base}/api/webhooks/razorpay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'payment.captured' }),
    });
    assert.ok([400, 503].includes(res.status), `expected 400/503, got ${res.status}`);
  });
});

describe('public write endpoints are rate limited before their routers', () => {
  const layers = (router as unknown as {
    stack: { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] }; name: string; handle: unknown; regexp?: RegExp }[];
  }).stack;

  const indexOfRoute = (path: string) =>
    layers.findIndex((l) => l.route?.path === path && l.route.methods.post);
  const indexOfMount = (needle: string) => layers.findIndex((l) => !l.route && String(l.regexp).includes(needle));

  it('POST /short-links goes through shortLinkCreateRateLimiter first', () => {
    const limiter = indexOfRoute('/short-links');
    const mount = indexOfMount('short-links');
    assert.ok(limiter >= 0 && mount >= 0);
    assert.ok(limiter < mount, 'limiter must run before the short-links router');
    assert.equal(layers[limiter]!.route!.stack[0]!.handle, shortLinkCreateRateLimiter);
  });

  it('POST /web-vitals goes through webVitalsRateLimiter first', () => {
    const limiter = indexOfRoute('/web-vitals');
    const mount = indexOfMount('web-vitals');
    assert.ok(limiter >= 0 && mount >= 0);
    assert.ok(limiter < mount, 'limiter must run before the web-vitals router');
    assert.equal(layers[limiter]!.route!.stack[0]!.handle, webVitalsRateLimiter);
  });
});

describe('POST /api/short-links over real HTTP', () => {
  const post = (body: unknown) =>
    fetch(`${base}/api/short-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('rejects invalid input (422) instead of storing it', async () => {
    for (const bad of [
      { targetUrl: 123 },
      { targetUrl: 'x'.repeat(3000) },
      { resourceType: 'VENDOR' },
      { resourceId: 'nope' },
    ]) {
      const res = await post(bad);
      assert.equal(res.status, 422, JSON.stringify(bad).slice(0, 50));
    }
  });

  it('regression: //evil.com comes back as "/" and fake preview text is ignored', async () => {
    const res = await post({ targetUrl: '//evil.com', metadata: { name: 'Account locked', price: 1 } });
    assert.equal(res.status, 201);
    const json = (await res.json()) as { data: { code: string; targetUrl: string; metadata: unknown } };
    assert.equal(json.data.targetUrl, '/');
    assert.equal(json.data.metadata, null);

    const resolved = await fetch(`${base}/api/short-links/${json.data.code}`);
    const body = (await resolved.json()) as { data: { targetUrl: string; metadata: unknown } };
    assert.equal(body.data.targetUrl, '/');
    assert.equal(body.data.metadata, null);

    const { ShortLink } = await import('@database/models/shortLink.model');
    await ShortLink.destroy({ where: { code: json.data.code } });
  });
});
