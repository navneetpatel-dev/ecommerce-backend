import { AuditLog } from '@database/models/auditLog.model';
import { Op } from 'sequelize';

export async function logAudit(input: { actorId: string; action: string; entityType: string; entityId: string; metadata?: Record<string, unknown> }) {
  return AuditLog.create({ ...input, metadata: input.metadata ?? {}, createdBy: input.actorId });
}

export async function listAudit(entityType?: string) {
  return AuditLog.findAll({ where: entityType ? { entityType: { [Op.eq]: entityType } } : undefined, order: [['createdAt', 'DESC']], limit: 100 });
}
