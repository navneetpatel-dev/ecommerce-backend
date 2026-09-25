import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import {
  PresignBulkSchema,
  PresignSingleSchema,
  UploadBulkSchema,
  UploadSingleSchema,
} from './uploads.dto';
import * as uploadsController from './uploads.controller';

const router = Router();

router.post('/presign', authenticate, validate(PresignSingleSchema), uploadsController.presignSingle);
router.post('/presign/bulk', authenticate, validate(PresignBulkSchema), uploadsController.presignBulk);
router.post('/', authenticate, validate(UploadSingleSchema), uploadsController.uploadSingle);
router.post('/bulk', authenticate, validate(UploadBulkSchema), uploadsController.uploadBulk);

export default router;
