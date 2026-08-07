import { AuditLog } from '@database/models/auditLog.model';
import { User } from '@database/models/user.model';
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

function serializeAuditLog(row: AuditLog) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    action: plain.action,
    entityType: plain.entityType,
    createdAt: plain.createdAt,
    actorName: plain.actor?.name ?? null,
  };
}

export async function listAudit(
  query: { page: number; limit: number },
  entityType?: string,
) {
  const offset = paginationOffset(query.page, query.limit);
  const { rows, count } = await AuditLog.findAndCountAll({
    where: entityType ? { entityType: { [Op.eq]: entityType } } : undefined,
    include: [{ model: User, as: 'actor', attributes: ['id', 'name'], required: false }],
    order: [['createdAt', 'DESC']],
    limit: query.limit,
    offset,
    distinct: true,
    col: 'id',
  });
  return {
    logs: rows.map((row) => serializeAuditLog(row)),
    pagination: buildPaginationMeta(count, query.page, query.limit),
  };
}
