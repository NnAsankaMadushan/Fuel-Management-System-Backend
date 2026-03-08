import express from "express";
import {
  receiveN8nNotification,
  getStationOwnerDailySummaries,
} from "../controllers/internalWebhookController.js";

const router = express.Router();

router.post("/notify", receiveN8nNotification);
router.get("/station-owner-daily-summaries", getStationOwnerDailySummaries);

export default router;
