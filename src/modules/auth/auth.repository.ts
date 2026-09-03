import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { RefreshToken } from '@database/models/refreshToken.model';
import { BaseRepository } from '@core/repository/BaseRepository';
import { Op } from 'sequelize';

export type RefreshTokenMeta = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  family: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  lastUsedAt?: Date | null;
};

export class AuthRepository extends BaseRepository<User> {
  constructor() {
    super(User);
  }

  /**
   * Email is globally unique (one account / role per email) and stored
   * lowercase — normalize here too, as a safety net independent of whether
   * the caller's input already went through a normalized DTO.
   */
  async findByEmail(email: string) {
    return User.findOne({
      where: { email: email.trim().toLowerCase() },
      include: [{ model: Role, as: 'role' }],
    });
  }

  /** Includes soft-deleted rows (for register-time reactivation). */
  async findByEmailIncludingDeleted(email: string) {
    return User.findOne({
      where: { email: email.trim().toLowerCase() },
      include: [{ model: Role, as: 'role' }],
      paranoid: false,
    });
  }

  async findByGoogleId(googleId: string) {
    return User.findOne({
      where: { googleId },
      include: [{ model: Role, as: 'role' }],
    });
  }

  async findRefreshToken(hash: string) {
    return RefreshToken.findOne({ where: { tokenHash: hash } });
  }

  async findLatestRefreshTokenByFamily(family: string) {
    return RefreshToken.findOne({
      where: { family },
      order: [['createdAt', 'DESC']],
    });
  }

  async createRefreshToken(data: RefreshTokenMeta) {
    return RefreshToken.create({
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      family: data.family,
      userAgent: data.userAgent ?? null,
      ipAddress: data.ipAddress ?? null,
      lastUsedAt: data.lastUsedAt ?? new Date(),
    } as any);
  }

  async deleteRefreshToken(hash: string) {
    return RefreshToken.destroy({ where: { tokenHash: hash } });
  }

  async deleteRefreshTokensByUser(userId: string) {
    return RefreshToken.destroy({ where: { userId } });
  }

  async deleteRefreshTokensByFamily(userId: string, family: string) {
    return RefreshToken.destroy({ where: { userId, family } });
  }

  async deleteRefreshTokensExceptFamily(userId: string, family: string) {
    return RefreshToken.destroy({
      where: {
        userId,
        family: { [Op.ne]: family },
      },
    });
  }

  async listRefreshTokensByUser(userId: string) {
    return RefreshToken.findAll({
      where: { userId },
      order: [['lastUsedAt', 'DESC'], ['createdAt', 'DESC']],
    });
  }
}

export const authRepository = new AuthRepository();
