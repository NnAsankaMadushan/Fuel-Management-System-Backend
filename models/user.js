import mongoose from "mongoose";
import { normalizeUserRole, USER_ROLES } from "../utils/helpers/normalizeUserRole.js";
import { normalizeNicNumber } from "../utils/helpers/normalizeNicNumber.js";

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
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);

export default User;
