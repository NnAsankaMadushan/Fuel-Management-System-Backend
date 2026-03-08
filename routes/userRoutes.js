import express from "express";
import {
  signupUser,
  resendSignupOtp,
  confirmSignupUser,
  createStationOwnerByAdmin,
  requestEmailVerificationOtp,
  verifyEmailVerificationOtp,
  loginUser,
  logoutUser,
  updateUser,
  changePassword,
  getUserProfile,
  getCurrentUser,
  getWebPushPublicConfig,
  registerPushToken,
  registerWebPushSubscription,
  unregisterWebPushSubscription,
} from "../controllers/userController.js";
import { protectRoute, authorizeAdmin } from "../middlewares/protectRoute.js";


const router = express.Router();
router.get("/profile/:username", getUserProfile);
router.get("/me", protectRoute, getCurrentUser);
router.get("/web-push/config", getWebPushPublicConfig);
router.post("/signup", signupUser);
router.post("/signup/resend-otp", resendSignupOtp);
router.post("/signup/confirm", confirmSignupUser);
router.post("/email-verification/request-otp", requestEmailVerificationOtp);
router.post("/email-verification/verify-otp", verifyEmailVerificationOtp);
router.post("/admin/station-owners", protectRoute, authorizeAdmin, createStationOwnerByAdmin);
router.post("/login", loginUser);
router.post("/logout", logoutUser);
router.put("/update/:id", protectRoute, updateUser);
router.put("/change-password", protectRoute, changePassword);
router.post("/push-token", protectRoute, registerPushToken);
router.post("/web-push/subscription", protectRoute, registerWebPushSubscription);
router.delete("/web-push/subscription", protectRoute, unregisterWebPushSubscription);

export default router;
