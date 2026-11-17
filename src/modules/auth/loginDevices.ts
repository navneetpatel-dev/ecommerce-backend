import { createHash } from 'crypto';
import { UserDevice } from '@database/models/userDevice.model';
import { User } from '@database/models/user.model';
import { logger } from '@core/logger';
import { notificationsService } from '@modules/notifications/notifications.service';

type DeviceMeta = { userAgent?: string | null; ipAddress?: string | null };

/** Browser + operating system in words ("Chrome on macOS"), from the user agent string. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'A browser';
  const os = /iphone|ipad|ios/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac os|macintosh/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : 'an unknown system';
  return `${browser} on ${os}`;
}

/** Same browser family and OS is the same device: IP addresses change too often to tell them apart. */
export function deviceFingerprint(userAgent: string | null | undefined): string {
  return createHash('sha256').update(describeDevice(userAgent)).digest('hex').slice(0, 32);
}

/**
 * Remembers the device a user signs in from. The first one is just recorded (there is
 * nothing to compare with); a later sign-in from a device not seen before emails the
 * owner so a stolen password is noticed.
 */
export async function recordLoginDevice(user: Pick<User, 'id'>, meta: DeviceMeta): Promise<void> {
  try {
    const fingerprint = deviceFingerprint(meta.userAgent);
    const [device, created] = await UserDevice.findOrCreate({
      where: { userId: user.id, fingerprint },
      defaults: {
        userId: user.id,
        fingerprint,
        userAgent: meta.userAgent?.slice(0, 400) ?? null,
        ipAddress: meta.ipAddress ?? null,
        lastSeenAt: new Date(),
      },
    });
    if (!created) {
      await device.update({ lastSeenAt: new Date(), ipAddress: meta.ipAddress ?? device.ipAddress });
      return;
    }
    if ((await UserDevice.count({ where: { userId: user.id } })) <= 1) return;

    await notificationsService.enqueue({
      userId: user.id,
      type: 'NEW_DEVICE_LOGIN',
      referenceType: 'UserDevice',
      referenceId: device.id,
      templateData: {
        details: [
          { label: 'Device', value: describeDevice(meta.userAgent) },
          ...(meta.ipAddress ? [{ label: 'IP address', value: meta.ipAddress }] : []),
          { label: 'Time', value: new Date().toUTCString() },
        ],
        callout: { tone: 'warning', text: 'If this was not you, reset your password now and sign out of all devices.' },
      },
    });
  } catch (error) {
    logger.warn('Login device check failed', { userId: user.id, error: error instanceof Error ? error.message : error });
  }
}
