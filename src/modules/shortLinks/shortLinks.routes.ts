import { Router } from 'express';
import { createShortLink, getShortLink } from './shortLinks.controller';

const router = Router();

router.post('/', createShortLink);
router.get('/:code', getShortLink);

export default router;
