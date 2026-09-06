import { AuditLog } from '@database/models/auditLog.model';
import { User } from '@database/models/user.model';
import { Op, type Transaction } from 'sequelize';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { getRequestContext } from '@core/context/requestContext';

export async function logAudit(input: {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  transaction?: Transaction;
}) {
  const { transaction, ...payload } = input;
  // Attributes every audit row written during an impersonated session to the real
  // acting admin, without every one of this module's ~50 call sites passing it through.
  const impersonatedBy = getRequestContext()?.impersonatedBy;
  const metadata = {
    ...(payload.metadata ?? {}),
    ...(impersonatedBy ? { impersonatedBy } : {}),
  };
  return AuditLog.create(
    { ...payload, metadata, createdBy: payload.actorId },
    transaction ? { transaction } : undefined,
  );
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

export type AuditListFilters = {
  entityType?: string;
  actorId?: string;
  /** Free-text match against the actor's name/email (case-insensitive substring). */
  actor?: string;
  from?: Date;
  to?: Date;
};

export async function listAudit(
  query: { page: number; limit: number },
  filters: AuditListFilters = {},
) {
  const offset = paginationOffset(query.page, query.limit);
  const { entityType, actorId, actor, from, to } = filters;

  const where: Record<PropertyKey, unknown> = {};
  if (entityType) where.entityType = { [Op.eq]: entityType };
  if (actorId) where.actorId = { [Op.eq]: actorId };
  if (from || to) {
    where.createdAt = {
      ...(from ? { [Op.gte]: from } : {}),
      ...(to ? { [Op.lte]: to } : {}),
    };
  }

  const { rows, count } = await AuditLog.findAndCountAll({
    where: Object.keys(where).length ? where : undefined,
    include: [
      {
        model: User,
        as: 'actor',
        attributes: ['id', 'name'],
        required: Boolean(actor),
        where: actor
          ? {
              [Op.or]: [
                { name: { [Op.iLike]: `%${actor}%` } },
                { email: { [Op.iLike]: `%${actor}%` } },
              ],
            }
          : undefined,
      },
    ],
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
