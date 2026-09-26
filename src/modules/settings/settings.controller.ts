import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { settingsService } from './settings.service';
import { UpdateSettingsSchema } from './settings.dto';

export const getPublicSettings = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await settingsService.getPlatformSettings();
  res.json(ok({
    freeShippingThreshold: settings.freeShippingThreshold,
    defaultReturnWindow: settings.defaultReturnWindow,
    supportEmail: settings.supportEmail,
    supportHours: settings.supportHours,
    ticketReopenWindowDays: settings.ticketReopenWindowDays,
    bugVerifyWindowDays: settings.bugVerifyWindowDays,
    bugCloseWindowDays: settings.bugCloseWindowDays,
    returnShippingFee: settings.returnShippingFee,
    codEnabled: settings.codEnabled,
    codMinOrderValue: settings.codMinOrderValue,
    codMaxOrderValue: settings.codMaxOrderValue,
    walletRechargeEnabled: settings.walletRechargeEnabled,
    walletMinRechargeInr: settings.walletMinRechargeInr,
    walletMaxRechargeInr: settings.walletMaxRechargeInr,
    walletRechargePresetsInr: settings.walletRechargePresetsInr,
    walletMaxBalancePoints: settings.walletMaxBalancePoints,
  }));
});

export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await settingsService.getPlatformSettings()));
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateSettingsSchema.parse(req.body);
  const result = await settingsService.updatePlatformSettings(dto, req.user!.id);
  res.json(ok(result));
});
