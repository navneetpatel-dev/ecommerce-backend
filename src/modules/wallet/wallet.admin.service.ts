import {
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { Op } from 'sequelize';
import { User } from '@database/models/user.model';
import { escapeLikePattern } from '@modules/search/search.utils';
import { walletService } from './wallet.service';
import { WALLET_DESCRIPTIONS } from './wallet.constants';
import { logAudit } from '@modules/audit/audit.service';
import type { AdjustWalletRequest, WalletUserSearchRequest } from './wallet.admin.dto';

export type AdjustWalletResult = {
  ledgerId: string;
  balance: number;
  purchasedBalance: number;
  promotionalBalance: number;
};

/** The only fields the wallet user lookup reveals: enough to tell two people apart, nothing more. */
export type WalletUserMatch = { id: string; name: string; email: string; status: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WalletAdminService {
  /**
   * Finds the account to adjust by name or email (or an exact pasted user id). Capped and
   * limited to a few identifying fields, so it cannot be used to browse the user base.
   */
  async searchUsers({ search, limit }: WalletUserSearchRequest): Promise<WalletUserMatch[]> {
    const term = search.trim();
    const where = UUID.test(term)
      ? { id: term }
      : { [Op.or]: [{ name: { [Op.iLike]: `%${escapeLikePattern(term)}%` } }, { email: { [Op.iLike]: `%${escapeLikePattern(term)}%` } }] };
    const rows = await User.findAll({
      where,
      attributes: ['id', 'name', 'email', 'status'],
      order: [['name', 'ASC'], ['email', 'ASC']],
      limit,
    });
    return rows.map((row) => ({ id: row.id, name: row.name, email: row.email, status: row.status }));
  }

  async adjustWallet(
    targetUserId: string,
    actorId: string,
    body: AdjustWalletRequest,
  ): Promise<AdjustWalletResult> {
    const ref = { type: WALLET_REFERENCE_TYPE.ADMIN_ADJUSTMENT, id: actorId };
    const description = `${WALLET_DESCRIPTIONS.ADMIN_ADJUSTMENT}: ${body.reason}`;

    const ledger =
      body.direction === 'CREDIT'
        ? await walletService.credit(
            targetUserId,
            body.amount,
            ref,
            description,
            undefined,
            {
              pointSource: body.pointSource ?? WALLET_POINT_SOURCE.PROMOTIONAL,
            },
          )
        : await walletService.debit(targetUserId, body.amount, ref, description);

    const [balance, subBalances] = await Promise.all([
      walletService.getBalance(targetUserId),
      walletService.getPointSourceBalances(targetUserId),
    ]);

    await logAudit({
      actorId,
      action: body.direction === 'CREDIT' ? 'WALLET_ADMIN_CREDIT' : 'WALLET_ADMIN_DEBIT',
      entityType: 'UserWallet',
      entityId: targetUserId,
      metadata: {
        amount: body.amount,
        direction: body.direction,
        reason: body.reason,
        ledgerId: ledger.id,
        newBalance: balance,
      },
    });

    return {
      ledgerId: ledger.id,
      balance,
      purchasedBalance: subBalances.purchased,
      promotionalBalance: subBalances.promotional,
    };
  }
}

export const walletAdminService = new WalletAdminService();
