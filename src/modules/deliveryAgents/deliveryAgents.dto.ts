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
export const SetAvailabilitySchema = z.object({ availableForAssignment: z.boolean() });
export const UpdateDeliveryStatusSchema = z.object({
  status: z.enum(['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'FAILED']),
  note: z.string().trim().min(3).max(1000).optional(),
}).superRefine((value, context) => {
  if (value.status === 'FAILED' && !value.note) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'A failed attempt reason is required' });
  }
});
export const ConfirmDeliverySchema = z.object({
  otpCode: z.string().regex(/^\d{6}$/),
  proofPhotoUrl: z.string().url().optional(),
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

export type CreateDeliveryAgentRequest = z.infer<typeof CreateDeliveryAgentSchema>;
export type UpdateDeliveryAgentRequest = z.infer<typeof UpdateDeliveryAgentSchema>;
export type ListDeliveryAgentsRequest = z.infer<typeof ListDeliveryAgentsSchema>;
