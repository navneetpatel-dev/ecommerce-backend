import {
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { walletService } from './wallet.service';
import { WALLET_DESCRIPTIONS } from './wallet.constants';
import type { AdjustWalletRequest } from './wallet.admin.dto';

export type AdjustWalletResult = {
  ledgerId: string;
  balance: number;
  purchasedBalance: number;
  promotionalBalance: number;
};

export class WalletAdminService {
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

    return {
      ledgerId: ledger.id,
      balance,
      purchasedBalance: subBalances.purchased,
      promotionalBalance: subBalances.promotional,
    };
  }
}

export const walletAdminService = new WalletAdminService();
