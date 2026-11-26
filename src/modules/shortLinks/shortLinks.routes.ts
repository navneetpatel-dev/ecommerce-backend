import { Router } from 'express';
import { validate } from '@middleware/validate.middleware';
import { CreateShortLinkSchema } from './shortLinks.dto';
import { createShortLink, getShortLink } from './shortLinks.controller';

const router = Router();

router.post('/', validate(CreateShortLinkSchema), createShortLink);
router.get('/:code', getShortLink);

export default router;
