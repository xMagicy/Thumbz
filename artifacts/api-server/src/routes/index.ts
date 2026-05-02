import { Router, type IRouter } from "express";
import healthRouter from "./health";
import thumbnailsRouter from "./thumbnails";
import battlesRouter from "./battles";
import feedbackRouter from "./feedback";
import waitlistRouter from "./waitlist";
import storageRouter from "./storage";
import contactRouter from "./contact";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/thumbnails", thumbnailsRouter);
router.use("/battles", battlesRouter);
router.use("/feedback", feedbackRouter);
router.use("/waitlist", waitlistRouter);
router.use(storageRouter);
router.use("/contact", contactRouter);

export default router;
