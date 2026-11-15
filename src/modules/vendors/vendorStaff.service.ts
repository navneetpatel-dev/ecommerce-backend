import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ROLES } from '@core/constants/statuses';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { RefreshToken } from '@database/models/refreshToken.model';
import { sequelize } from '@database/models';
import { clearPermissionCache } from '@middleware/rbac.middleware';
import { logAudit } from '@modules/audit/audit.service';
import { authService } from '@modules/auth/auth.service';
import type { AddStaffRequest } from './vendorStaff.dto';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  status: string;
  roleName: string;
  isOwner: boolean;
  createdAt: Date;
}

export class VendorStaffService {
  async listStaff(vendorId: string): Promise<StaffMember[]> {
    const users = await User.findAll({
      where: { vendorId },
      include: [{ model: Role, as: 'role', attributes: ['id', 'name'] }],
      attributes: ['id', 'name', 'email', 'status', 'createdAt', 'roleId'],
      order: [['createdAt', 'ASC']],
    });
    return users.map((u) => {
      const userWithRole = u as User & { role?: { name: string } };
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        status: u.status,
        roleName: userWithRole.role?.name ?? 'VENDOR_STAFF',
        isOwner: userWithRole.role?.name === ROLES.VENDOR_OWNER,
        createdAt: u.createdAt,
      };
    });
  }

  async addStaff(
    vendorId: string,
    data: AddStaffRequest,
    actorId: string,
  ): Promise<{ id: string; name: string; email: string; roleName: string; isOwner: boolean }> {
    return sequelize.transaction(async (t) => {
      const staffRole = await Role.findOne({ where: { name: ROLES.VENDOR_STAFF }, transaction: t });
      if (!staffRole) throw new NotFoundError('Role VENDOR_STAFF');

      const existingUser = await User.findOne({
        where: { email: data.email.toLowerCase() },
        include: [{ model: Role, as: 'role' }],
        transaction: t,
      });

      if (existingUser) {
        if (existingUser.vendorId && existingUser.vendorId !== vendorId) {
          throw new ValidationError('User is already assigned to another vendor');
        }
        if (existingUser.vendorId === vendorId) {
          throw new ValidationError('User is already a member of this vendor team');
        }
        if ((existingUser as User & { role?: { name: string } }).role?.name === ROLES.SUPER_ADMIN) {
          throw new ForbiddenError('Cannot assign super admin as vendor staff');
        }

        await existingUser.update(
          {
            vendorId,
            roleId: staffRole.id,
            updatedBy: actorId,
          },
          { transaction: t },
        );
        clearPermissionCache();
        await logAudit({
          actorId,
          action: 'VENDOR_STAFF_ADDED',
          entityType: 'User',
          entityId: existingUser.id,
          metadata: { vendorId, email: existingUser.email },
          transaction: t,
        });

        return {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          roleName: ROLES.VENDOR_STAFF,
          isOwner: false,
        };
      }

      const randomPassword = crypto.randomBytes(16).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 10);

      const newUser = await User.create(
        {
          name: data.name,
          email: data.email.toLowerCase(),
          passwordHash,
          roleId: staffRole.id,
          vendorId,
          status: 'ACTIVE',
          emailVerified: true,
          createdBy: actorId,
        },
        { transaction: t },
      );

      await logAudit({
        actorId,
        action: 'VENDOR_STAFF_CREATED',
        entityType: 'User',
        entityId: newUser.id,
        metadata: { vendorId, email: newUser.email },
        transaction: t,
      });

      clearPermissionCache();

      void authService.forgotPassword(newUser.email);

      return {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        roleName: ROLES.VENDOR_STAFF,
        isOwner: false,
      };
    });
  }

  async removeStaff(
    vendorId: string,
    targetUserId: string,
    actorId: string,
  ): Promise<{ success: boolean }> {
    return sequelize.transaction(async (t) => {
      const user = await User.findOne({
        where: { id: targetUserId, vendorId },
        include: [{ model: Role, as: 'role' }],
        transaction: t,
      });

      if (!user) throw new NotFoundError('Staff member not found on this vendor');
      if ((user as User & { role?: { name: string } }).role?.name === ROLES.VENDOR_OWNER) {
        throw new ForbiddenError('Cannot remove the vendor owner from staff');
      }

      const customerRole = await Role.findOne({ where: { name: ROLES.CUSTOMER }, transaction: t });
      if (!customerRole) throw new NotFoundError('Role CUSTOMER');

      await user.update(
        {
          vendorId: null,
          roleId: customerRole.id,
          updatedBy: actorId,
        },
        { transaction: t },
      );

      await RefreshToken.destroy({
        where: { userId: targetUserId },
        transaction: t,
      });

      clearPermissionCache();

      await logAudit({
        actorId,
        action: 'VENDOR_STAFF_REMOVED',
        entityType: 'User',
        entityId: targetUserId,
        metadata: { vendorId },
        transaction: t,
      });

      return { success: true };
    });
  }
}

export const vendorStaffService = new VendorStaffService();
