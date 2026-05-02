import { Router, type IRouter } from "express";
import healthRouter from "./health";
import thumbnailsRouter from "./thumbnails";
import battlesRouter from "./battles";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/thumbnails", thumbnailsRouter);
router.use("/battles", battlesRouter);

export default router;
