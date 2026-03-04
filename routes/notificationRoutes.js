import express from "express";
import {
  getMyNotifications,
  markNotificationAsRead,
} from "../controllers/notificationController.js";
import { protectRoute } from "../middlewares/protectRoute.js";

const router = express.Router();

router.get("/mine", protectRoute, getMyNotifications);
router.patch("/:id/read", protectRoute, markNotificationAsRead);

export default router;
