import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { walletService } from './wallet.service';
import { walletRechargeService } from './walletRecharge.service';
import {
  CreateWalletRechargeSchema,
  VerifyWalletRechargeSchema,
} from './walletRecharge.dto';
import { exportWalletStatementDirect } from './walletStatement.service';
import { WalletStatementSchema } from './walletStatement.dto';
import { ListTransactionsSchema } from './wallet.dto';

export const getBalance = asyncHandler(async (req: Request, res: Response) => {
  const view = await walletRechargeService.getBalanceView(req.user!.id);
  res.json(ok(view));
});

export const createRecharge = asyncHandler(async (req: Request, res: Response) => {
  const body = CreateWalletRechargeSchema.parse(req.body);
  const checkout = await walletRechargeService.createRecharge(
    req.user!.id,
    body.amountInr,
    body.idempotencyKey,
  );
  res.json(ok(checkout));
});

export const verifyRecharge = asyncHandler(async (req: Request, res: Response) => {
  const body = VerifyWalletRechargeSchema.parse(req.body);
  const result = await walletRechargeService.verifyRecharge(req.user!.id, {
    razorpayOrderId: body.razorpayOrderId!,
    razorpayPaymentId: body.razorpayPaymentId!,
    razorpaySignature: body.razorpaySignature!,
    rechargeId: body.rechargeId,
  });
  res.json(ok(result));
});

export const getRecharge = asyncHandler(async (req: Request, res: Response) => {
  const result = await walletRechargeService.getRecharge(
    req.user!.id,
    String(req.params.id),
  );
  res.json(ok(result));
});

export const downloadRechargeInvoice = asyncHandler(async (req: Request, res: Response) => {
  const { buffer, filename } = await walletRechargeService.downloadInvoicePdf(
    req.user!.id,
    String(req.params.id),
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const query = ListTransactionsSchema.parse(req.query);
  const result = await walletService.listTransactionsView(req.user!.id, query);
  res.json(ok(result.transactions, { pagination: result.pagination }));
});

export const exportStatement = asyncHandler(async (req: Request, res: Response) => {
  const query = WalletStatementSchema.parse(req.query);
  const result = await exportWalletStatementDirect(req.user!, {
    from: query.from,
    to: query.to,
    format: query.format,
  });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.buffer);
});
