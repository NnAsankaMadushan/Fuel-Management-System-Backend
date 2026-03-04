import express from "express";
import {
  signupUser,
  loginUser,
  logoutUser,
  updateUser,
  getUserProfile,
  getCurrentUser,
} from "../controllers/userController.js";
import { protectRoute } from "../middlewares/protectRoute.js";


const router = express.Router();
router.get("/profile/:username", getUserProfile);
router.get("/me", protectRoute, getCurrentUser);
router.post("/signup", signupUser);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.put("/update/:id", protectRoute, updateUser);

export default router;
