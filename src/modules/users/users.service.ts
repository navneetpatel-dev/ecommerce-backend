import fs from 'fs/promises';
import path from 'path';
import jwt from 'jsonwebtoken';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { usersRepository } from './users.repository';
import { addressesRepository } from './addresses.repository';
import { authRepository } from '../auth/auth.repository';
import { Role } from '@database/models/role.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { Review } from '@database/models/review.model';
import { Wishlist } from '@database/models/wishlist.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { WalletLedger } from '@database/models/walletLedger.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import type {
  UpdateUserProfileRequest,
  UpdateUserStatusRequest,
  GetUsersQuery,
  CreateAddressRequest,
  UpdateAddressRequest,
  NotificationPrefs,
  UploadAvatarRequest,
} from './users.dto';

const DEFAULT_PREFS: NotificationPrefs = {
  orderUpdates: true,
  smsAlerts: false,
  shippingNotifications: true,
};

function serializeAddress(address: {
  id: string;
  userId: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  country: string;
  pincode: string;
  isDefault: boolean;
}) {
  return {
    id: address.id,
    userId: address.userId,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    country: address.country,
    pincode: address.pincode,
    isDefault: Boolean(address.isDefault),
  };
}

function normalizePrefs(raw: unknown): NotificationPrefs {
  const prefs = (raw && typeof raw === 'object' ? raw : {}) as Partial<NotificationPrefs>;
  return {
    orderUpdates: prefs.orderUpdates ?? DEFAULT_PREFS.orderUpdates,
    smsAlerts: prefs.smsAlerts ?? DEFAULT_PREFS.smsAlerts,
    shippingNotifications: prefs.shippingNotifications ?? DEFAULT_PREFS.shippingNotifications,
  };
}

function serializeProfile(user: any) {
  const plain = typeof user.get === 'function' ? user.get({ plain: true }) : user;
  const roleName = plain.Role?.name ?? plain.role?.name ?? null;

  return {
    id: plain.id,
    email: plain.email,
    name: plain.name,
    phone: plain.phone ?? null,
    role: roleName,
    vendorId: plain.vendorId ?? null,
    emailVerified: Boolean(plain.emailVerified),
    emailMarketingConsent: Boolean(plain.emailMarketingConsent),
    avatarUrl: plain.avatarUrl ?? null,
    pendingEmail: plain.pendingEmail ?? null,
    notificationPrefs: normalizePrefs(plain.notificationPrefs),
    createdAt: plain.createdAt,
  };
}

const profileInclude = [
  { model: Role },
  { model: Vendor },
];

function issueEmailVerifyToken(userId: string, email: string) {
  return jwt.sign(
    { sub: userId, email, purpose: 'email-verify' },
    env.JWT_SECRET,
    { expiresIn: '24h' },
  );
}

export class UsersService {
  async getProfile(userId: string) {
    const user = await usersRepository.findById(userId, { include: profileInclude });
    if (!user) throw new NotFoundError('User');
    return serializeProfile(user);
  }

  async updateProfile(userId: string, data: UpdateUserProfileRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');

      const patch: Record<string, unknown> = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.phone !== undefined) patch.phone = data.phone;
      if (data.emailMarketingConsent !== undefined) {
        patch.emailMarketingConsent = data.emailMarketingConsent;
      }
      if (data.notificationPrefs !== undefined) {
        patch.notificationPrefs = {
          ...normalizePrefs(user.notificationPrefs),
          ...data.notificationPrefs,
        };
      }

      let emailVerificationToken: string | undefined;

      if (data.email !== undefined) {
        const nextEmail = data.email.trim().toLowerCase();
        if (nextEmail !== user.email.toLowerCase()) {
          const existing = await usersRepository.findOne(
            { email: nextEmail } as any,
            { transaction: t },
          );
          if (existing && existing.id !== userId) {
            throw new ValidationError({ email: ['Email already in use'] });
          }
          patch.pendingEmail = nextEmail;
          emailVerificationToken = issueEmailVerifyToken(userId, nextEmail);
          logger.info('Email change requested', { userId, pendingEmail: nextEmail });
        }
      }

      await usersRepository.update(userId, patch as any, { transaction: t });
      const updated = await usersRepository.findById(userId, {
        include: profileInclude,
        transaction: t,
      });
      const profile = serializeProfile(updated!);
      return emailVerificationToken ? { ...profile, emailVerificationToken } : profile;
    });
  }

  async confirmEmailChange(userId: string, token: string) {
    let decoded: { sub: string; email: string; purpose: string };
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as { sub: string; email: string; purpose: string };
    } catch {
      throw new ValidationError({ token: ['Invalid or expired verification token'] });
    }

    if (decoded.purpose !== 'email-verify' || decoded.sub !== userId) {
      throw new ValidationError({ token: ['Invalid verification token'] });
    }

    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');
      if (!user.pendingEmail || user.pendingEmail.toLowerCase() !== decoded.email.toLowerCase()) {
        throw new ValidationError({ token: ['No matching pending email change'] });
      }

      const existing = await usersRepository.findOne(
        { email: decoded.email } as any,
        { transaction: t },
      );
      if (existing && existing.id !== userId) {
        throw new ValidationError({ email: ['Email already in use'] });
      }

      await usersRepository.update(
        userId,
        {
          email: decoded.email,
          pendingEmail: null,
          emailVerified: true,
        } as any,
        { transaction: t },
      );

      const updated = await usersRepository.findById(userId, {
        include: profileInclude,
        transaction: t,
      });
      return serializeProfile(updated!);
    });
  }

  async uploadAvatar(userId: string, data: UploadAvatarRequest) {
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(data.dataUrl);
    if (!match) {
      throw new ValidationError({ dataUrl: ['Invalid image data URL'] });
    }

    const extRaw = match[1]!.toLowerCase();
    const ext = extRaw === 'jpg' ? 'jpeg' : extRaw;
    const buffer = Buffer.from(match[2]!, 'base64');
    if (buffer.byteLength > 1.5 * 1024 * 1024) {
      throw new ValidationError({ dataUrl: ['Image must be under 1.5MB'] });
    }

    const dir = path.resolve(process.cwd(), 'uploads', 'avatars');
    await fs.mkdir(dir, { recursive: true });
    const filename = `${userId}.${ext === 'jpeg' ? 'jpg' : ext}`;
    await fs.writeFile(path.join(dir, filename), buffer);

    const avatarUrl = `/uploads/avatars/${filename}?t=${Date.now()}`;
    await usersRepository.update(userId, { avatarUrl } as any);
    const updated = await usersRepository.findById(userId, { include: profileInclude });
    return serializeProfile(updated!);
  }

  async exportAccountData(userId: string) {
    const user = await usersRepository.findById(userId, { include: profileInclude });
    if (!user) throw new NotFoundError('User');

    const [addresses, orders, reviews, returns, walletTx, wishlists] = await Promise.all([
      addressesRepository.findByUserId(userId),
      Order.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 200,
      }),
      Review.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
      ReturnRequest.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
      WalletLedger.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 200,
      }),
      Wishlist.findAll({
        where: { userId },
        include: [{ model: WishlistItem, as: 'items' }],
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      profile: serializeProfile(user),
      addresses: addresses.map(serializeAddress),
      orders,
      reviews,
      returns,
      walletTransactions: walletTx,
      wishlists,
    };
  }

  async listAddresses(userId: string) {
    const addresses = await addressesRepository.findByUserId(userId);
    return addresses.map(serializeAddress);
  }

  async createAddress(userId: string, data: CreateAddressRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const existing = await addressesRepository.findByUserId(userId);
      const makeDefault = Boolean(data.isDefault) || existing.length === 0;

      if (makeDefault) {
        await addressesRepository.clearDefaultsForUser(userId, { transaction: t });
      }

      const address = await addressesRepository.create(
        {
          userId,
          line1: data.line1,
          line2: data.line2 ?? null,
          city: data.city,
          state: data.state,
          country: data.country || 'India',
          pincode: data.pincode,
          isDefault: makeDefault,
        } as any,
        { transaction: t },
      );

      return serializeAddress(address);
    });
  }

  async updateAddress(userId: string, addressId: string, data: UpdateAddressRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const address = await addressesRepository.findById(addressId, { transaction: t });
      if (!address || address.userId !== userId) throw new NotFoundError('Address');

      if (data.isDefault === true) {
        await addressesRepository.clearDefaultsForUser(userId, { transaction: t });
      }

      const nextIsDefault =
        data.isDefault === undefined ? address.isDefault : Boolean(data.isDefault);

      await addressesRepository.update(
        addressId,
        {
          ...(data.line1 !== undefined ? { line1: data.line1 } : {}),
          ...(data.line2 !== undefined ? { line2: data.line2 } : {}),
          ...(data.city !== undefined ? { city: data.city } : {}),
          ...(data.state !== undefined ? { state: data.state } : {}),
          ...(data.country !== undefined ? { country: data.country } : {}),
          ...(data.pincode !== undefined ? { pincode: data.pincode } : {}),
          ...(data.isDefault !== undefined ? { isDefault: nextIsDefault } : {}),
        } as any,
        { transaction: t },
      );

      if (data.isDefault === false && address.isDefault) {
        const remaining = await addressesRepository.findByUserId(userId, { transaction: t });
        const next = remaining.find((row) => row.id !== addressId);
        if (next) {
          await addressesRepository.update(next.id, { isDefault: true } as any, {
            transaction: t,
          });
        } else {
          await addressesRepository.update(addressId, { isDefault: true } as any, {
            transaction: t,
          });
        }
      }

      const updated = await addressesRepository.findById(addressId, { transaction: t });
      return serializeAddress(updated!);
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const address = await addressesRepository.findById(addressId, { transaction: t });
      if (!address || address.userId !== userId) throw new NotFoundError('Address');

      const wasDefault = address.isDefault;
      await addressesRepository.softDelete(addressId, { transaction: t });

      if (wasDefault) {
        const remaining = await addressesRepository.findByUserId(userId, { transaction: t });
        const next = remaining.find((row) => row.id !== addressId);
        if (next) {
          await addressesRepository.update(next.id, { isDefault: true } as any, {
            transaction: t,
          });
        }
      }
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const address = await addressesRepository.findById(addressId, { transaction: t });
      if (!address || address.userId !== userId) throw new NotFoundError('Address');

      await addressesRepository.clearDefaultsForUser(userId, { transaction: t });
      await addressesRepository.update(addressId, { isDefault: true } as any, { transaction: t });

      const updated = await addressesRepository.findById(addressId, { transaction: t });
      return serializeAddress(updated!);
    });
  }

  async deleteOwnAccount(userId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');
      await authRepository.deleteRefreshTokensByUser(userId);
      await usersRepository.softDelete(userId, { transaction: t });
    });
  }

  async getUsers(query: GetUsersQuery) {
    const offset = (query.page - 1) * query.limit;
    const { rows, count } = await usersRepository.findWithFilters({
      roleId: query.roleId,
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset,
    });

    return {
      users: rows.map(serializeProfile),
      pagination: {
        total: count,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(count / query.limit),
      },
    };
  }

  async getUserById(userId: string) {
    const user = await usersRepository.findById(userId, { include: profileInclude });
    if (!user) throw new NotFoundError('User');
    return serializeProfile(user);
  }

  async updateUserStatus(userId: string, data: UpdateUserStatusRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');

      await usersRepository.update(userId, data, { transaction: t });
      return this.getUserById(userId);
    });
  }

  async deleteUser(userId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');
      await usersRepository.softDelete(userId, { transaction: t });
    });
  }
}

export const usersService = new UsersService();
