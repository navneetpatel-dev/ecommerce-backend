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

function isAdminBypass(roleName: string): boolean {
  return (
    roleName === ROLES.SUPER_ADMIN ||
    roleName === ROLES.ADMIN_CATALOG_MANAGER ||
    roleName === ROLES.ADMIN_ORDER_MANAGER
  );
}

export const checkOwnership = (resourceType: ResourceType) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return next(new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED));
    }

    if (isAdminBypass(user.role.name)) {
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
      const message =
        resourceType === 'product'
          ? ERROR_MESSAGES.NOT_YOUR_PRODUCT
          : resourceType === 'suborder'
            ? ERROR_MESSAGES.NOT_YOUR_ORDER
            : 'Not your resource';
      return next(new ForbiddenError(message));
    }

    next();
  };
};

/** Resolves product_images.imageId → product.vendorId for image mutation routes. */
export const checkProductImageOwnership = () => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return next(new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED));
    }

    if (isAdminBypass(user.role.name)) {
      return next();
    }

    const imageId = req.params.imageId;
    const [row] = await sequelize.query<{ vendorId: string | null }>(
      `SELECT p."vendorId"
       FROM product_images pi
       INNER JOIN products p ON p.id = pi."productId"
       WHERE pi.id = :imageId
         AND pi."deletedAt" IS NULL
         AND p."deletedAt" IS NULL
       LIMIT 1`,
      { replacements: { imageId }, type: QueryTypes.SELECT },
    );

    if (!row) {
      return next(new NotFoundError('ProductImage'));
    }

    if (row.vendorId !== user.vendorId) {
      return next(new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_PRODUCT));
    }

    next();
  };
};
