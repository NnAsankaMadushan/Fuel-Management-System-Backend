import express from "express";
import {
  signupUser,
  createStationOwnerByAdmin,
  loginUser,
  logoutUser,
  updateUser,
  changePassword,
  getUserProfile,
  getCurrentUser,
} from "../controllers/userController.js";
import { protectRoute, authorizeAdmin } from "../middlewares/protectRoute.js";


const router = express.Router();
router.get("/profile/:username", getUserProfile);
router.get("/me", protectRoute, getCurrentUser);
router.post("/signup", signupUser);
router.post("/admin/station-owners", protectRoute, authorizeAdmin, createStationOwnerByAdmin);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.put("/update/:id", protectRoute, updateUser);
router.put("/change-password", protectRoute, changePassword);

export default router;
