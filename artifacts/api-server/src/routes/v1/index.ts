import { Router, type IRouter } from "express";
import { apiKeyAuth } from "../../middleware/api-auth.js";
import contactsRouter from "./contacts.js";
import templatesRouter from "./templates.js";
import campaignsRouter from "./campaigns.js";
import mailboxesRouter from "./mailboxes.js";
import analyticsRouter from "./analytics.js";

const router: IRouter = Router();

router.use(apiKeyAuth);

router.use(contactsRouter);
router.use(templatesRouter);
router.use(campaignsRouter);
router.use(mailboxesRouter);
router.use(analyticsRouter);

export default router;
