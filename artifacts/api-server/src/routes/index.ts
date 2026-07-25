import { Router, type IRouter } from "express";
import healthRouter from "./health";
import usersRouter from "./users";
import rolesRouter from "./roles";
import geographyRouter from "./geography";
import dashboardRouter from "./dashboard";
import configRouter from "./config";
import auditRouter from "./audit";
import volunteersRouter from "./volunteers";
import supportersRouter from "./supporters";
import trainingRouter from "./training";
import publicPortalRouter from "./publicPortal";
import dataRequestsRouter from "./dataRequests";
import coordinatorRouter from "./coordinator";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/users", usersRouter);
router.use("/roles", rolesRouter);
router.use("/geography", geographyRouter);
router.use("/dashboard", dashboardRouter);
router.use("/config", configRouter);
router.use("/audit", auditRouter);
router.use("/volunteers", volunteersRouter);
router.use("/supporters", supportersRouter);
router.use("/training", trainingRouter);
router.use("/public", publicPortalRouter);
router.use("/data-requests", dataRequestsRouter);
router.use("/coordinator", coordinatorRouter);

export default router;
