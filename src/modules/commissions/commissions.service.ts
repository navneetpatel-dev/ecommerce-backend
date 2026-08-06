import { CommissionLedger } from '@database/models/commissionLedger.model';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

function serializeCommission(row: CommissionLedger) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    ...plain,
    saleAmount: Number(plain.saleAmount),
    commissionRate: Number(plain.commissionRate),
    commissionAmount: Number(plain.commissionAmount),
  };
}

export class CommissionsService {
  async list(query: { page: number; limit: number }, vendorId?: string | null) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await CommissionLedger.findAndCountAll({
      where: vendorId ? { vendorId } : undefined,
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
    });
    return {
      commissions: rows.map((row) => serializeCommission(row)),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async listByVendor(vendorId: string) {
    const rows = await CommissionLedger.findAll({ where: { vendorId } });
    return rows.map((row) => serializeCommission(row));
  }
}

export const commissionsService = new CommissionsService();
