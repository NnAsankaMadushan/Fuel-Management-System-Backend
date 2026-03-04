import express from "express";
import {
  getAllVehicles,
  getVehicleById,
  registerVehicle,
  reviewVehicleRegistration,
  deleteVehicle,
  getMyVehicles,
} from "../controllers/vehicleController.js";
import { addVehicleRegistry } from "../controllers/vehicleRegistryController.js";
import { protectRoute, authorizeAdmin } from "../middlewares/protectRoute.js";

const router = express.Router();
router.get("/", protectRoute, authorizeAdmin, getAllVehicles);
router.get("/mine", protectRoute, getMyVehicles);
router.get("/user/:id", protectRoute, getMyVehicles);
router.get("/:id", protectRoute, getVehicleById);
router.post("/register", protectRoute, registerVehicle);
router.post("/registry", protectRoute, authorizeAdmin, addVehicleRegistry);
router.patch("/:id/approval", protectRoute, authorizeAdmin, reviewVehicleRegistration);
router.delete("/:id", protectRoute, authorizeAdmin, deleteVehicle);


export default router;
