import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { sequelize } from '@config/db';
import { QueryTypes } from 'sequelize';
import { ROLES } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';

type ResourceType = 'product' | 'suborder' | 'vendor';

const resourceQueries: Record<ResourceType, string> = {
  product: 'SELECT "vendorId" FROM products WHERE id = :id',
  suborder: 'SELECT "vendorId" FROM sub_orders WHERE id = :id',
  vendor: 'SELECT id as "vendorId" FROM vendors WHERE id = :id',
};

export const checkOwnership = (resourceType: ResourceType) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return next(new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED));
    }

    if (
      user.role.name === ROLES.SUPER_ADMIN ||
      user.role.name === ROLES.ADMIN_CATALOG_MANAGER ||
      user.role.name === ROLES.ADMIN_ORDER_MANAGER
    ) {
      return next();
    }

    const id = req.params.id;
    const query = resourceQueries[resourceType];
    const [resource] = await sequelize.query<{ vendorId: string | null }>(query, {
      replacements: { id },
      type: QueryTypes.SELECT,
    });

    if (!resource) {
      return next(new NotFoundError(resourceType));
    }

    if (resource.vendorId !== user.vendorId) {
      return next(new ForbiddenError('Not your resource'));
    }

    next();
  };
};
