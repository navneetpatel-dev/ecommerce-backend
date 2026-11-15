import { z } from 'zod';

export const AddStaffSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(100),
});

export type AddStaffRequest = z.infer<typeof AddStaffSchema>;
