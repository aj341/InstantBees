import { Router, type IRouter } from "express";
import healthRouter from "./health";
import campaignsRouter from "./campaigns";
import leadsRouter from "./leads";
import accountsRouter from "./accounts";
import sequencesRouter from "./sequences";
import inboxRouter from "./inbox";
import analyticsRouter from "./analytics";
import mcpRouter from "./mcp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(campaignsRouter);
router.use(leadsRouter);
router.use(accountsRouter);
router.use(sequencesRouter);
router.use(inboxRouter);
router.use(analyticsRouter);
router.use(mcpRouter);

export default router;
