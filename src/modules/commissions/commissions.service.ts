import { CommissionLedger } from '@database/models/commissionLedger.model';

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
  async list(vendorId?: string | null) {
    const rows = await CommissionLedger.findAll({
      where: vendorId ? { vendorId } : undefined,
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => serializeCommission(row));
  }

  async listByVendor(vendorId: string) {
    const rows = await CommissionLedger.findAll({ where: { vendorId } });
    return rows.map((row) => serializeCommission(row));
  }
}

export const commissionsService = new CommissionsService();
