import express from "express";
import {
  registerFuelTransaction,
  checkFuelQuota,
  getVehicleTransactions,
  getStationTransactions,
  getStationSummary,
} from "../controllers/fuelController.js";
import { protectRoute } from "../middlewares/protectRoute.js";

const router = express.Router();

router.get("/vehicle-logs", protectRoute, getVehicleTransactions);
router.get("/station-logs", protectRoute, getStationTransactions);
router.get("/station-summary", protectRoute, getStationSummary);
router.post("/register", protectRoute, registerFuelTransaction);
router.post("/check-quota", protectRoute, checkFuelQuota);

export default router;
