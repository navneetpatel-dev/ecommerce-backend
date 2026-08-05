import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { RefreshToken } from '@database/models/refreshToken.model';
import { BaseRepository } from '@core/repository/BaseRepository';

export class AuthRepository extends BaseRepository<User> {
  constructor() {
    super(User);
  }

  async findByEmail(email: string) {
    return User.findOne({ where: { email }, include: [Role] });
  }

  async findRefreshToken(hash: string) {
    return RefreshToken.findOne({ where: { tokenHash: hash } });
  }

  async createRefreshToken(data: { userId: string; tokenHash: string; expiresAt: Date; family: string }) {
    return RefreshToken.create(data);
  }

  async deleteRefreshToken(hash: string) {
    return RefreshToken.destroy({ where: { tokenHash: hash } });
  }

  async deleteRefreshTokensByUser(userId: string) {
    return RefreshToken.destroy({ where: { userId } });
  }
}
