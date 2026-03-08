import mongoose from "mongoose";
import { normalizeUserRole, USER_ROLES } from "../utils/helpers/normalizeUserRole.js";
import { normalizeNicNumber } from "../utils/helpers/normalizeNicNumber.js";

const webPushSubscriptionSchema = new mongoose.Schema(
  {
    endpoint: {
      type: String,
      required: true,
      trim: true,
    },
    expirationTime: {
      type: Number,
      default: null,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
      },
      auth: {
        type: String,
        required: true,
      },
    },
    userAgent: {
      type: String,
      default: "",
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
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
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationOtpHash: {
      type: String,
      select: false,
    },
    emailVerificationOtpExpiresAt: {
      type: Date,
      select: false,
    },
    emailVerificationOtpSentAt: {
      type: Date,
      select: false,
    },
    password: {
      type: String,
      required: true,
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
      unique: true,
      sparse: true,
      set: normalizeNicNumber,
    },
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    pushTokens: {
      type: [String],
      default: [],
    },
    webPushSubscriptions: {
      type: [webPushSubscriptionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);

export default User;
