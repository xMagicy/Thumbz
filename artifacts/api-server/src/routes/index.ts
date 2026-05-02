import { Router, type IRouter } from "express";
import healthRouter from "./health";
import thumbnailsRouter from "./thumbnails";
import battlesRouter from "./battles";
import feedbackRouter from "./feedback";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/thumbnails", thumbnailsRouter);
router.use("/battles", battlesRouter);
router.use("/feedback", feedbackRouter);

export default router;
