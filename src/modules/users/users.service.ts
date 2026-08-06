import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { AppError } from '@core/errors';
import {
  deleteObject,
  extractS3KeyFromUrl,
  isS3Configured,
  uploadObject,
} from '@config/s3';
import { usersRepository } from './users.repository';
import { addressesRepository } from './addresses.repository';
import { authRepository } from '../auth/auth.repository';
import { Role } from '@database/models/role.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { Review } from '@database/models/review.model';
import { Wishlist } from '@database/models/wishlist.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import type {
  UpdateUserProfileRequest,
  UpdateUserStatusRequest,
  GetUsersQuery,
  CreateAddressRequest,
  UpdateAddressRequest,
  UploadAvatarRequest,
} from './users.dto';
import { MAX_AVATAR_BYTES } from '@core/constants/http';

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
    createdAt: plain.createdAt,
  };
}

const profileInclude = [
  { model: Role },
  { model: Vendor },
];

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

      await usersRepository.update(userId, patch as any, { transaction: t });
      const updated = await usersRepository.findById(userId, {
        include: profileInclude,
        transaction: t,
      });
      return serializeProfile(updated!);
    });
  }

  async uploadAvatar(userId: string, data: UploadAvatarRequest) {
    if (!isS3Configured()) {
      throw new AppError(
        'Profile photo upload requires AWS S3. Configure AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and S3_BUCKET.',
        503,
        'S3_NOT_CONFIGURED',
      );
    }

    const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(data.dataUrl);
    if (!match) {
      throw new ValidationError({ dataUrl: ['Invalid image data URL'] });
    }

    const extRaw = match[1]!.toLowerCase();
    const ext = extRaw === 'jpg' ? 'jpeg' : extRaw;
    const contentType = `image/${ext}`;
    const buffer = Buffer.from(match[2]!, 'base64');
    if (buffer.byteLength > MAX_AVATAR_BYTES) {
      throw new ValidationError({ dataUrl: ['Image must be under 1.5MB'] });
    }

    const user = await usersRepository.findById(userId);
    if (!user) throw new NotFoundError('User');

    const fileExt = ext === 'jpeg' ? 'jpg' : ext;
    const key = `avatars/${userId}/${Date.now()}.${fileExt}`;
    const avatarUrl = await uploadObject({ key, body: buffer, contentType });

    const previousKey = extractS3KeyFromUrl(user.avatarUrl);
    await usersRepository.update(userId, { avatarUrl } as any);

    if (previousKey && previousKey.startsWith('avatars/')) {
      await deleteObject(previousKey);
    }

    const updated = await usersRepository.findById(userId, { include: profileInclude });
    return serializeProfile(updated!);
  }

  async exportAccountData(userId: string) {
    const user = await usersRepository.findById(userId, { include: profileInclude });
    if (!user) throw new NotFoundError('User');

    const [addresses, orders, reviews, returns, wishlists] = await Promise.all([
      addressesRepository.findByUserId(userId),
      Order.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 200,
      }),
      Review.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
      ReturnRequest.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
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
