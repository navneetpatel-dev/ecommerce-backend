import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { logger } from '@core/logger';

interface JwtPayload {
  sub: string;
  email: string;
  roleId: string;
  vendorId: string | null;
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
      return;
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    const user = await User.findByPk(decoded.sub, { include: [Role] });
    if (!user || user.status === 'BLOCKED') {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'User not found or blocked' } });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      roleId: user.roleId,
      vendorId: user.vendorId,
      role: { name: user.role?.name ?? 'CUSTOMER' },
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } });
      return;
    }
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
};
