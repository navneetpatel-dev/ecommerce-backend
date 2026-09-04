import { z } from 'zod';
import { pageLimitQuerySchema } from '@core/http/pagination';

const vehicleTypes = ['BIKE', 'SCOOTER', 'VAN', 'BICYCLE'] as const;
const agentStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;

export const ListDeliveryAgentsSchema = pageLimitQuerySchema.extend({
  hubOrZone: z.string().trim().min(1).optional(),
  status: z.enum(agentStatuses).optional(),
});

export const CreateDeliveryAgentSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8),
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(20),
  vehicleType: z.enum(vehicleTypes).default('BIKE'),
  hubOrZone: z.string().trim().min(1).max(120),
});

export const UpdateDeliveryAgentSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(6).max(20).optional(),
  vehicleType: z.enum(vehicleTypes).optional(),
  hubOrZone: z.string().trim().min(1).max(120).optional(),
  status: z.enum(agentStatuses).optional(),
});

export const AssignAgentSchema = z.object({ deliveryAgentId: z.string().uuid() });
export const BulkAssignShipmentsSchema = z.object({
  shipmentIds: z.array(z.string().uuid()).min(1).max(100),
  deliveryAgentId: z.string().uuid(),
});
export const SetAvailabilitySchema = z.object({ availableForAssignment: z.boolean() });
export const UpdateDeliveryStatusSchema = z.object({
  status: z.enum(['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'FAILED']),
  note: z.string().trim().min(3).max(1000).optional(),
  /** Optional evidence photo for a FAILED attempt (e.g. locked gate, wrong address). */
  photoUrl: z.string().url().optional(),
}).superRefine((value, context) => {
  if (value.status === 'FAILED' && !value.note) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'A failed attempt reason is required' });
  }
});
export const ConfirmRtoHandoverSchema = z.object({
  otpCode: z.string().regex(/^\d{6}$/),
});
export const CloseCashShiftSchema = z.object({
  amount: z.number().min(0),
  note: z.string().trim().max(500).optional(),
});
export const VerifyCashDepositSchema = z.object({
  action: z.enum(['VERIFY', 'REJECT']),
  rejectionReason: z.string().trim().min(3).max(500).optional(),
}).superRefine((value, context) => {
  if (value.action === 'REJECT' && !value.rejectionReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rejectionReason'],
      message: 'A reason is required to reject a cash deposit',
    });
  }
});
export const ConfirmDeliverySchema = z.object({
  otpCode: z.string().regex(/^\d{6}$/),
  proofPhotoUrl: z.string().url().optional(),
  codCollected: z.boolean().optional(),
});
export const UpdatePickupStatusSchema = z.object({
  status: z.literal('FAILED'),
  note: z.string().trim().min(3).max(1000),
});
export const ConfirmPickupSchema = z.object({
  otpCode: z.string().regex(/^\d{6}$/),
  itemConditionPhotoUrls: z.array(z.string().url()).max(8).optional(),
  replacementProofUrl: z.string().url().optional(),
});
export const ForceConfirmSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
export const UpdateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const SubmitDocumentSchema = z.object({
  type: z.enum(['ID_PROOF', 'DRIVING_LICENSE', 'VEHICLE_RC', 'ADDRESS_PROOF']),
  url: z.string().url(),
});
export const ReviewDocumentSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().trim().min(3).max(500).optional(),
}).superRefine((value, context) => {
  if (value.action === 'REJECT' && !value.rejectionReason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rejectionReason'],
      message: 'A reason is required to reject a document',
    });
  }
});

export type CreateDeliveryAgentRequest = z.infer<typeof CreateDeliveryAgentSchema>;
export type UpdateDeliveryAgentRequest = z.infer<typeof UpdateDeliveryAgentSchema>;
export type ListDeliveryAgentsRequest = z.infer<typeof ListDeliveryAgentsSchema>;
export type BulkAssignShipmentsRequest = z.infer<typeof BulkAssignShipmentsSchema>;
export type UpdateLocationRequest = z.infer<typeof UpdateLocationSchema>;
export type CloseCashShiftRequest = z.infer<typeof CloseCashShiftSchema>;
export type VerifyCashDepositRequest = z.infer<typeof VerifyCashDepositSchema>;
export type SubmitDocumentRequest = z.infer<typeof SubmitDocumentSchema>;
export type ReviewDocumentRequest = z.infer<typeof ReviewDocumentSchema>;
