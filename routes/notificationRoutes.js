import express from "express";
import {
  getMyNotifications,
  markAllMyNotificationsAsRead,
  markNotificationAsRead,
} from "../controllers/notificationController.js";
import { protectRoute } from "../middlewares/protectRoute.js";

const router = express.Router();

router.get("/mine", protectRoute, getMyNotifications);
router.patch("/mine/read", protectRoute, markAllMyNotificationsAsRead);
router.patch("/:id/read", protectRoute, markNotificationAsRead);

export default router;
