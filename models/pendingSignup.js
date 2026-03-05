import mongoose from "mongoose";
import { normalizeNicNumber } from "../utils/helpers/normalizeNicNumber.js";
import {
  normalizeUserRole,
  USER_ROLES,
} from "../utils/helpers/normalizeUserRole.js";

const pendingSignupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      required: true,
      enum: USER_ROLES,
      default: "vehicle_owner",
      set: normalizeUserRole,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    nicNumber: {
      type: String,
      required: true,
      unique: true,
      set: normalizeNicNumber,
    },
    signupOtpHash: {
      type: String,
      required: true,
      select: false,
    },
    signupOtpExpiresAt: {
      type: Date,
      required: true,
      select: false,
    },
    signupOtpSentAt: {
      type: Date,
      required: true,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

const PendingSignup = mongoose.model("PendingSignup", pendingSignupSchema);

export default PendingSignup;
