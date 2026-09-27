import { Router } from 'express';
import * as controller from '../controllers/support.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  adminReplySchema,
  adminTicketsQuerySchema,
  adminUpdateTicketSchema,
  closeTicketSchema,
  createFaqSchema,
  createTicketSchema,
  listFaqsQuerySchema,
  myTicketsQuerySchema,
  publicFaqsQuerySchema,
  replyTicketSchema,
  supportIdParamSchema,
  updateConfigSchema,
  updateFaqSchema,
} from '../validators/support.validator';

const router = Router();

// Public — the app's Help & Support screen (categories, contact, FAQs).
router.get('/config', controller.config);
router.get('/faqs', validate(publicFaqsQuerySchema), controller.publicFaqs);

// Customer — their own tickets.
router.post('/tickets', authenticate('CUSTOMER'), validate(createTicketSchema), controller.createTicket);
router.get('/tickets', authenticate('CUSTOMER'), validate(myTicketsQuerySchema), controller.myTickets);
router.get('/tickets/:id', authenticate('CUSTOMER'), validate(supportIdParamSchema), controller.myTicket);
router.post('/tickets/:id/messages', authenticate('CUSTOMER'), validate(replyTicketSchema), controller.customerReply);
router.post('/tickets/:id/close', authenticate('CUSTOMER'), validate(closeTicketSchema), controller.customerClose);

// Admin — help-desk inbox + content.
const admin = Router();
admin.use(authenticateAdmin);
admin.get('/tickets', requirePermission(PERMISSIONS.SUPPORT_TICKET_VIEW), validate(adminTicketsQuerySchema), controller.adminTickets);
admin.get('/tickets/:id', requirePermission(PERMISSIONS.SUPPORT_TICKET_VIEW), validate(supportIdParamSchema), controller.adminTicket);
admin.post('/tickets/:id/messages', requirePermission(PERMISSIONS.SUPPORT_TICKET_MANAGE), validate(adminReplySchema), controller.adminReply);
admin.patch('/tickets/:id', requirePermission(PERMISSIONS.SUPPORT_TICKET_MANAGE), validate(adminUpdateTicketSchema), controller.adminUpdateTicket);
admin.get('/config', requirePermission(PERMISSIONS.SUPPORT_TICKET_VIEW), controller.adminConfig);
admin.put('/config', requirePermission(PERMISSIONS.SUPPORT_CONTENT_MANAGE), validate(updateConfigSchema), controller.updateConfig);
admin.get('/faqs', requirePermission(PERMISSIONS.SUPPORT_TICKET_VIEW), validate(listFaqsQuerySchema), controller.listFaqs);
admin.post('/faqs', requirePermission(PERMISSIONS.SUPPORT_CONTENT_MANAGE), validate(createFaqSchema), controller.createFaq);
admin.patch('/faqs/:id', requirePermission(PERMISSIONS.SUPPORT_CONTENT_MANAGE), validate(updateFaqSchema), controller.updateFaq);
admin.delete('/faqs/:id', requirePermission(PERMISSIONS.SUPPORT_CONTENT_MANAGE), validate(supportIdParamSchema), controller.deleteFaq);
router.use('/admin', admin);

export default router;
