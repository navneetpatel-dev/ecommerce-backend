import { AuditLog } from '@database/models/auditLog.model';
import { Op } from 'sequelize';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

export async function logAudit(input: {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  return AuditLog.create({ ...input, metadata: input.metadata ?? {}, createdBy: input.actorId });
}

export async function listAudit(
  query: { page: number; limit: number },
  entityType?: string,
) {
  const offset = paginationOffset(query.page, query.limit);
  const { rows, count } = await AuditLog.findAndCountAll({
    where: entityType ? { entityType: { [Op.eq]: entityType } } : undefined,
    order: [['createdAt', 'DESC']],
    limit: query.limit,
    offset,
  });
  return {
    logs: rows,
    pagination: buildPaginationMeta(count, query.page, query.limit),
  };
}
