import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import lmsRouter from "./lms";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(lmsRouter);

export default router;
