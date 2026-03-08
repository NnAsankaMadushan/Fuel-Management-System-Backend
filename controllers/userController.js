import bcrypt from "bcryptjs";
import User from "../models/user.js";
import PendingSignup from "../models/pendingSignup.js";
import {
  clearAuthCookie,
  generateToken,
  setAuthCookie,
} from "../utils/helpers/genarateTokenAndSetCookie.js";
import FuelStation from "../models/fuelStation.js";
import Vehicle from "../models/vehicle.js";
import {
  isSupportedUserRole,
  normalizeUserRole,
} from "../utils/helpers/normalizeUserRole.js";
import { normalizeNicNumber } from "../utils/helpers/normalizeNicNumber.js";
import sendEmail from "../utils/helpers/sendEmail.js";
import triggerAccountCreatedWebhook from "../utils/helpers/sendN8nWebhook.js";
import {
  EMAIL_OTP_EXPIRY_MINUTES,
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  EMAIL_OTP_REGEX,
  isEmailOtpDebugEnabled,
  generateEmailVerificationOtp,
  hashEmailVerificationOtp,
  getOtpRetryAfterSeconds,
  issueEmailVerificationOtp,
} from "../utils/helpers/emailVerificationOtp.js";

const isMobileClient = (req) => req.get("X-Client-Platform") === "mobile";
const EXPO_PUSH_TOKEN_REGEX =
  /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const WEB_PUSH_MAX_SUBSCRIPTIONS = 10;

const getWebPushVapidPublicKey = () =>
  String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();

const getWebPushConfigState = () => {
  const vapidPublicKey = getWebPushVapidPublicKey();
  const vapidPrivateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim();
  const vapidSubject = String(process.env.WEB_PUSH_VAPID_SUBJECT || "").trim();

  return {
    enabled: Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject),
    vapidPublicKey: vapidPublicKey || null,
  };
};

const normalizeWebPushSubscriptionInput = (payload = {}) => {
  const endpoint = String(payload?.endpoint || "").trim();
  const p256dh = String(payload?.keys?.p256dh || "").trim();
  const auth = String(payload?.keys?.auth || "").trim();
  const incomingExpiration = payload?.expirationTime;
  const parsedExpiration = Number(incomingExpiration);

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint,
    keys: { p256dh, auth },
    expirationTime:
      incomingExpiration === null ||
      incomingExpiration === undefined ||
      incomingExpiration === ""
        ? null
        : Number.isFinite(parsedExpiration)
          ? parsedExpiration
          : null,
  };
};

const buildSignupOtpContent = (otp, recipientName = "") => {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const subject = "FuelPlus Signup OTP";
  const text = `${greeting}
Use the OTP below to confirm your FuelPlus signup:

${otp}

This OTP will expire in ${EMAIL_OTP_EXPIRY_MINUTES} minutes.
Your account will be created only after OTP verification.`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <p>${greeting}</p>
      <p>Use the OTP below to confirm your FuelPlus signup:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px; margin: 16px 0;">${otp}</p>
      <p>This OTP will expire in ${EMAIL_OTP_EXPIRY_MINUTES} minutes.</p>
      <p>Your account will be created only after OTP verification.</p>
    </div>
  `;

  return { subject, text, html };
};

const issueSignupOtp = async (pendingSignup, { enforceCooldown = true } = {}) => {
  const retryAfterSeconds = getOtpRetryAfterSeconds(pendingSignup.signupOtpSentAt);

  if (enforceCooldown && retryAfterSeconds > 0) {
    return {
      sent: false,
      throttled: true,
      retryAfterSeconds,
    };
  }

  const otp = generateEmailVerificationOtp();
  const expiresAt = new Date(Date.now() + EMAIL_OTP_EXPIRY_MINUTES * 60 * 1000);

  pendingSignup.signupOtpHash = hashEmailVerificationOtp(otp);
  pendingSignup.signupOtpExpiresAt = expiresAt;
  pendingSignup.signupOtpSentAt = new Date();
  await pendingSignup.save();

  const emailContent = buildSignupOtpContent(otp, pendingSignup.name);
  const emailResult = await sendEmail({
    to: pendingSignup.email,
    ...emailContent,
  });

  return {
    sent: Boolean(emailResult?.delivered),
    throttled: false,
    retryAfterSeconds: EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
    debugOtp: isEmailOtpDebugEnabled() ? otp : undefined,
    deliveryReason: emailResult?.reason || "",
  };
};

const buildStationContext = async (userId, role) => {
  if (role !== "station_owner" && role !== "station_operator") {
    return {};
  }

  const stationQuery =
    role === "station_owner"
      ? { fuelStationOwner: userId }
      : { stationOperators: userId };

  const stations = await FuelStation.find(stationQuery).select("stationName");
  const stationNames = stations
    .map((station) => station?.stationName)
    .filter(Boolean);

  return {
    stationNames,
    primaryStationName: stationNames[0] || "",
  };
};

// Signup a new user
const signupUser = async (req, res) => {
  try {
    const { name, email, password, role, phoneNumber } = req.body;
    const nicNumber = normalizeNicNumber(req.body.nicNumber);
    const normalizedRole = normalizeUserRole(role || "vehicle_owner");

    if (!name || !email || !password || !phoneNumber || !nicNumber) {
      res.status(400).json({
        message:
          "Name, email, password, phone number, and NIC number are required",
      });
      return;
    }

    if (!isSupportedUserRole(normalizedRole)) {
      res.status(400).json({ message: "Invalid user role" });
      return;
    }

    if (normalizedRole !== "vehicle_owner") {
      res
        .status(403)
        .json({ message: "Only vehicle owner accounts can be created through public signup" });
      return;
    }

    const [existingEmailUser, existingNicUser, pendingSignupByEmail] = await Promise.all([
      User.findOne({ email }),
      User.findOne({ nicNumber }),
      PendingSignup.findOne({ email }).select(
        "+passwordHash +signupOtpHash +signupOtpExpiresAt +signupOtpSentAt"
      ),
    ]);

    if (existingEmailUser) {
      res.status(400).json({ message: "User already exists" });
      return;
    }

    if (existingNicUser) {
      res.status(400).json({ message: "A user with this NIC number already exists" });
      return;
    }

    const duplicatePendingNic = await PendingSignup.findOne({
      nicNumber,
      ...(pendingSignupByEmail ? { _id: { $ne: pendingSignupByEmail._id } } : {}),
    });

    if (duplicatePendingNic) {
      res.status(400).json({
        message: "A pending signup with this NIC number already exists",
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const pendingSignup = pendingSignupByEmail || new PendingSignup();

    pendingSignup.name = name;
    pendingSignup.email = email;
    pendingSignup.passwordHash = hashedPassword;
    pendingSignup.role = normalizedRole;
    pendingSignup.phoneNumber = phoneNumber;
    pendingSignup.nicNumber = nicNumber;

    const otpDispatchResult = await issueSignupOtp(pendingSignup, {
      enforceCooldown: Boolean(pendingSignupByEmail),
    });

    if (otpDispatchResult.throttled) {
      res.status(429).json({
        message: `Please wait ${otpDispatchResult.retryAfterSeconds} seconds before requesting a new OTP`,
        retryAfterSeconds: otpDispatchResult.retryAfterSeconds,
      });
      return;
    }

    res.status(pendingSignupByEmail ? 200 : 201).json({
      email: pendingSignup.email,
      name: pendingSignup.name,
      requiresEmailVerification: true,
      otpDeliveryStatus: otpDispatchResult.sent ? "sent" : "failed",
      message: otpDispatchResult.sent
        ? "OTP has been sent to your email. Verify OTP to complete account creation."
        : "OTP generated, but email delivery failed. Please retry sending OTP.",
      ...(otpDispatchResult.debugOtp
        ? { debugOtp: otpDispatchResult.debugOtp }
        : {}),
    });
  } catch (error) {
    if (
      error?.code === 11000 &&
      (error?.keyPattern?.nicNumber || error?.keyPattern?.email)
    ) {
      res.status(400).json({
        message:
          error?.keyPattern?.email
            ? "A pending signup with this email already exists"
            : "A pending signup with this NIC number already exists",
      });
      return;
    }

    res.status(500).json({ message: error.message });
    console.log("Error in signupUser: ", error.message);
  }
};

const resendSignupOtp = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();

    if (!email) {
      res.status(400).json({ message: "Email is required" });
      return;
    }

    const [pendingSignup, existingUser] = await Promise.all([
      PendingSignup.findOne({ email }).select(
        "+signupOtpHash +signupOtpExpiresAt +signupOtpSentAt"
      ),
      User.findOne({ email }),
    ]);

    if (existingUser) {
      res.status(400).json({
        message: "Account already exists for this email. Please login.",
      });
      return;
    }

    if (!pendingSignup) {
      res.status(404).json({
        message: "No pending signup found for this email. Please signup again.",
      });
      return;
    }

    const otpDispatchResult = await issueSignupOtp(pendingSignup, {
      enforceCooldown: true,
    });

    if (otpDispatchResult.throttled) {
      res.status(429).json({
        message: `Please wait ${otpDispatchResult.retryAfterSeconds} seconds before requesting a new OTP`,
        retryAfterSeconds: otpDispatchResult.retryAfterSeconds,
      });
      return;
    }

    res.status(200).json({
      message: otpDispatchResult.sent
        ? "A new OTP has been sent."
        : "OTP generated, but email delivery failed. Please retry after SMTP is available.",
      otpDeliveryStatus: otpDispatchResult.sent ? "sent" : "failed",
      ...(otpDispatchResult.debugOtp
        ? { debugOtp: otpDispatchResult.debugOtp }
        : {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in resendSignupOtp: ", error.message);
  }
};

const confirmSignupUser = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const otp = String(req.body?.otp || "").trim();

    if (!email || !otp) {
      res.status(400).json({ message: "Email and OTP are required" });
      return;
    }

    if (!EMAIL_OTP_REGEX.test(otp)) {
      res.status(400).json({ message: "OTP must be a 6-digit code" });
      return;
    }

    const pendingSignup = await PendingSignup.findOne({ email }).select(
      "+passwordHash +signupOtpHash +signupOtpExpiresAt +signupOtpSentAt"
    );

    if (!pendingSignup) {
      res.status(404).json({
        message: "No pending signup found for this email. Please signup again.",
      });
      return;
    }

    if (
      !pendingSignup.signupOtpHash ||
      !pendingSignup.signupOtpExpiresAt
    ) {
      res.status(400).json({
        message: "No active OTP found. Please request a new OTP.",
      });
      return;
    }

    if (new Date(pendingSignup.signupOtpExpiresAt).getTime() < Date.now()) {
      res.status(400).json({
        message: "OTP has expired. Please request a new OTP.",
      });
      return;
    }

    const incomingOtpHash = hashEmailVerificationOtp(otp);
    if (incomingOtpHash !== pendingSignup.signupOtpHash) {
      res.status(400).json({ message: "Invalid OTP" });
      return;
    }

    const [existingEmailUser, existingNicUser] = await Promise.all([
      User.findOne({ email: pendingSignup.email }),
      User.findOne({ nicNumber: pendingSignup.nicNumber }),
    ]);

    if (existingEmailUser || existingNicUser) {
      await PendingSignup.deleteOne({ _id: pendingSignup._id });
      res.status(400).json({
        message:
          existingEmailUser
            ? "User already exists"
            : "A user with this NIC number already exists",
      });
      return;
    }

    const newUser = new User({
      name: pendingSignup.name,
      email: pendingSignup.email,
      password: pendingSignup.passwordHash,
      role: normalizeUserRole(pendingSignup.role || "vehicle_owner"),
      phoneNumber: pendingSignup.phoneNumber,
      nicNumber: pendingSignup.nicNumber,
      emailVerified: true,
      mustChangePassword: false,
    });

    await newUser.save();
    await PendingSignup.deleteOne({ _id: pendingSignup._id });

    const n8nDispatchResult = await triggerAccountCreatedWebhook(newUser);

    res.status(201).json({
      message: "Email verified successfully. Account created. You can now log in.",
      emailVerified: true,
      email: newUser.email,
      accountCreatedEmailTriggerStatus: n8nDispatchResult.delivered
        ? "sent_to_n8n"
        : "n8n_failed",
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.nicNumber) {
      res.status(400).json({ message: "A user with this NIC number already exists" });
      return;
    }

    if (error?.code === 11000 && error?.keyPattern?.email) {
      res.status(400).json({ message: "User already exists" });
      return;
    }

    res.status(500).json({ message: error.message });
    console.log("Error in confirmSignupUser: ", error.message);
  }
};

const createStationOwnerByAdmin = async (req, res) => {
  try {
    const { name, email, password, phoneNumber } = req.body;
    const nicNumber = normalizeNicNumber(req.body.nicNumber);
    const role = "station_owner";

    if (!name || !email || !password || !phoneNumber || !nicNumber) {
      res.status(400).json({
        message:
          "Name, email, password, phone number, and NIC number are required",
      });
      return;
    }

    const [existingEmailUser, existingNicUser] = await Promise.all([
      User.findOne({ email }),
      User.findOne({ nicNumber }),
    ]);

    if (existingEmailUser) {
      res.status(400).json({ message: "User already exists" });
      return;
    }

    if (existingNicUser) {
      res.status(400).json({ message: "A user with this NIC number already exists" });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
      phoneNumber,
      nicNumber,
      emailVerified: false,
      mustChangePassword: true,
    });

    await newUser.save();
    const otpDispatchResult = await issueEmailVerificationOtp(newUser, {
      enforceCooldown: false,
    });

    res.status(201).json({
      _id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      role: normalizeUserRole(newUser.role),
      phoneNumber: newUser.phoneNumber,
      nicNumber: newUser.nicNumber,
      mustChangePassword: newUser.mustChangePassword,
      emailVerified: Boolean(newUser.emailVerified),
      otpDeliveryStatus: otpDispatchResult.sent ? "sent" : "failed",
      message: otpDispatchResult.sent
        ? "Station owner account created successfully. Verification OTP has been sent to the user's email. The user must verify email and then change the temporary password on first login."
        : "Station owner account created successfully, but OTP email delivery failed. Request another OTP before first login.",
      ...(otpDispatchResult.debugOtp
        ? { debugOtp: otpDispatchResult.debugOtp }
        : {}),
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.nicNumber) {
      res.status(400).json({ message: "A user with this NIC number already exists" });
      return;
    }

    res.status(500).json({ message: error.message });
    console.log("Error in createStationOwnerByAdmin: ", error.message);
  }
};

// Login a user
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const mobileClient = isMobileClient(req);
    const user = await User.findOne({ email });
    const isPasswordCorrect =
      user && (await bcrypt.compare(password, user.password));

    if (isPasswordCorrect) {
      const normalizedRole = normalizeUserRole(user.role);

      if (normalizedRole !== user.role) {
        user.role = normalizedRole;
        await user.save();
      }

      if (user.emailVerified === false) {
        res.status(403).json({
          message:
            "Email is not verified. Please verify your email using OTP before logging in.",
          code: "EMAIL_NOT_VERIFIED",
          email: user.email,
        });
        return;
      }

      const token = generateToken(user._id);

      if (!mobileClient) {
        setAuthCookie(res, token);
      }

      let additionalData = {};

      if (normalizedRole === "station_owner") {
        const stations = await FuelStation.find({ fuelStationOwner: user._id });
        additionalData.stations = stations;
        additionalData = {
          ...additionalData,
          ...(await buildStationContext(user._id, normalizedRole)),
        };
      } else if (normalizedRole === "station_operator") {
        additionalData = await buildStationContext(user._id, normalizedRole);
      } else if (normalizedRole === "vehicle_owner") {
        const vehicles = await Vehicle.find({ vehicleOwner: user._id });
        additionalData.vehicles = vehicles;
      }

      res.status(200).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: normalizedRole,
        phoneNumber: user.phoneNumber,
        nicNumber: user.nicNumber,
        mustChangePassword: Boolean(user.mustChangePassword),
        emailVerified: user.emailVerified !== false,
        ...(mobileClient ? { token } : {}),
        ...additionalData,
      });
    } else {
      res.status(401).json({ message: "Invalid email or password" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in loginUser: ", error.message);
  }
};

// Logout a user
const logoutUser = async (req, res) => {
  try {
    clearAuthCookie(res);
    res.status(200).json({ message: "User logged out" });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in logoutUser: ", error.message);
  }
};

//Update a user
const updateUser = async (req, res) => {
  const { name, email, phoneNumber } = req.body;
  const nicNumberInputProvided = Object.prototype.hasOwnProperty.call(
    req.body,
    "nicNumber"
  );
  const emailInputProvided = Object.prototype.hasOwnProperty.call(req.body, "email");
  const nextEmail = typeof email === "string" ? email.trim() : "";
  const nicNumber = normalizeNicNumber(req.body.nicNumber);
  const userId = req.user._id;

  try {
    let user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if(req.params.id !== userId.toString()) {
      res.status(403).json({ message: "You are not allowed to perform this action" });
      return;
    }

    let emailChanged = false;

    user.name = name || user.name;
    user.phoneNumber = phoneNumber || user.phoneNumber;

    if (emailInputProvided) {
      if (!nextEmail) {
        res.status(400).json({ message: "Email cannot be empty" });
        return;
      }

      const duplicateEmailUser = await User.findOne({
        email: nextEmail,
        _id: { $ne: userId },
      });

      if (duplicateEmailUser) {
        res.status(400).json({ message: "User already exists" });
        return;
      }

      if (nextEmail !== user.email) {
        user.email = nextEmail;
        user.emailVerified = false;
        emailChanged = true;
      }
    }

    if (nicNumberInputProvided) {
      if (!nicNumber) {
        res.status(400).json({ message: "NIC number cannot be empty" });
        return;
      }

      const duplicateNicUser = await User.findOne({
        nicNumber,
        _id: { $ne: userId },
      });

      if (duplicateNicUser) {
        res.status(400).json({ message: "A user with this NIC number already exists" });
        return;
      }

      user.nicNumber = nicNumber;
    }

    user = await user.save();
    let otpDispatchResult;

    if (emailChanged) {
      otpDispatchResult = await issueEmailVerificationOtp(user, {
        enforceCooldown: false,
      });
    }

    res.status(200).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        nicNumber: user.nicNumber,
        mustChangePassword: Boolean(user.mustChangePassword),
        emailVerified: user.emailVerified !== false,
      },
      message: emailChanged
        ? otpDispatchResult?.sent
          ? "User updated successfully. Verification OTP has been sent to your new email."
          : "User updated successfully, but OTP email delivery failed. Request another OTP to verify your email."
        : "User updated successfully",
      ...(otpDispatchResult?.debugOtp
        ? { debugOtp: otpDispatchResult.debugOtp }
        : {}),
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.nicNumber) {
      res.status(400).json({ message: "A user with this NIC number already exists" });
      return;
    }

    res.status(500).json({ message: error.message });
    console.log("Error in updateUser: ", error.message);
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?._id;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ message: "Current password and new password are required" });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ message: "New password must be at least 6 characters long" });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({ message: "New password must be different from the current password" });
      return;
    }

    const user = await User.findById(userId);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const isCurrentPasswordCorrect = await bcrypt.compare(currentPassword, user.password);

    if (!isCurrentPasswordCorrect) {
      res.status(400).json({ message: "Current password is incorrect" });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.mustChangePassword = false;

    const normalizedRole = normalizeUserRole(user.role);
    if (normalizedRole !== user.role) {
      user.role = normalizedRole;
    }

    await user.save();

    res.status(200).json({
      message: "Password changed successfully",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: normalizeUserRole(user.role),
        phoneNumber: user.phoneNumber,
        nicNumber: user.nicNumber,
        mustChangePassword: Boolean(user.mustChangePassword),
        emailVerified: user.emailVerified !== false,
        ...(await buildStationContext(user._id, normalizeUserRole(user.role))),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in changePassword: ", error.message);
  }
};

//
const getUserProfile = async (req, res) => {
  const name = req.params.username;
  try {
    const user = await User.findOne({ name }).select("-password").select("-updatedAt");
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    user.role = normalizeUserRole(user.role);
    res.status(200).json(user);
    
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getUserProfile: ", error.message); 
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: normalizeUserRole(user.role),
      phoneNumber: user.phoneNumber,
      nicNumber: user.nicNumber,
      mustChangePassword: Boolean(user.mustChangePassword),
      emailVerified: user.emailVerified !== false,
      ...(await buildStationContext(user._id, normalizeUserRole(user.role))),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getCurrentUser: ", error.message);
  }
};

const registerPushToken = async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();

    if (!token) {
      res.status(400).json({ message: "Push token is required" });
      return;
    }

    if (!EXPO_PUSH_TOKEN_REGEX.test(token)) {
      res.status(400).json({ message: "Invalid Expo push token" });
      return;
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const existingTokens = Array.isArray(user.pushTokens)
      ? user.pushTokens.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    const nextTokens = [token, ...existingTokens.filter((entry) => entry !== token)].slice(0, 5);

    user.pushTokens = nextTokens;
    await user.save();

    res.status(200).json({
      message: "Push token saved",
      tokenCount: nextTokens.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in registerPushToken: ", error.message);
  }
};

const getWebPushPublicConfig = async (_req, res) => {
  try {
    const { enabled, vapidPublicKey } = getWebPushConfigState();
    res.status(200).json({
      enabled,
      vapidPublicKey,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getWebPushPublicConfig: ", error.message);
  }
};

const registerWebPushSubscription = async (req, res) => {
  try {
    const { enabled } = getWebPushConfigState();

    if (!enabled) {
      res.status(503).json({ message: "Web push is not configured on the server" });
      return;
    }

    const incomingPayload =
      typeof req.body?.subscription === "object" && req.body?.subscription
        ? req.body.subscription
        : req.body;
    const subscription = normalizeWebPushSubscriptionInput(incomingPayload);

    if (!subscription) {
      res.status(400).json({ message: "Invalid web push subscription payload" });
      return;
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const userAgent = String(req.get("user-agent") || "").trim().slice(0, 512);
    const currentSubscriptions = Array.isArray(user.webPushSubscriptions)
      ? user.webPushSubscriptions
      : [];
    const now = new Date();
    const existingEntry = currentSubscriptions.find(
      (entry) => String(entry?.endpoint || "").trim() === subscription.endpoint
    );
    const nextEntry = {
      ...subscription,
      userAgent,
      createdAt: existingEntry?.createdAt || now,
      updatedAt: now,
    };

    const dedupedSubscriptions = currentSubscriptions.filter(
      (entry) => String(entry?.endpoint || "").trim() !== subscription.endpoint
    );

    user.webPushSubscriptions = [nextEntry, ...dedupedSubscriptions].slice(
      0,
      WEB_PUSH_MAX_SUBSCRIPTIONS
    );

    await User.updateMany(
      {
        _id: { $ne: user._id },
        "webPushSubscriptions.endpoint": subscription.endpoint,
      },
      { $pull: { webPushSubscriptions: { endpoint: subscription.endpoint } } }
    );

    await user.save();

    res.status(200).json({
      message: "Web push subscription saved",
      subscriptionCount: user.webPushSubscriptions.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in registerWebPushSubscription: ", error.message);
  }
};

const unregisterWebPushSubscription = async (req, res) => {
  try {
    const incomingPayload =
      typeof req.body?.subscription === "object" && req.body?.subscription
        ? req.body.subscription
        : req.body;
    const endpoint = String(incomingPayload?.endpoint || "").trim();

    if (!endpoint) {
      res.status(400).json({ message: "Subscription endpoint is required" });
      return;
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const currentSubscriptions = Array.isArray(user.webPushSubscriptions)
      ? user.webPushSubscriptions
      : [];
    const nextSubscriptions = currentSubscriptions.filter(
      (entry) => String(entry?.endpoint || "").trim() !== endpoint
    );
    const removedCount = currentSubscriptions.length - nextSubscriptions.length;

    user.webPushSubscriptions = nextSubscriptions;
    await user.save();

    res.status(200).json({
      message:
        removedCount > 0
          ? "Web push subscription removed"
          : "Web push subscription was already removed",
      removedCount,
      subscriptionCount: nextSubscriptions.length,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in unregisterWebPushSubscription: ", error.message);
  }
};

const requestEmailVerificationOtp = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();

    if (!email) {
      res.status(400).json({ message: "Email is required" });
      return;
    }

    const user = await User.findOne({ email }).select(
      "+emailVerificationOtpHash +emailVerificationOtpExpiresAt +emailVerificationOtpSentAt"
    );

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (user.emailVerified !== false) {
      res.status(200).json({
        message: "Email is already verified",
        emailVerified: true,
      });
      return;
    }

    const otpDispatchResult = await issueEmailVerificationOtp(user, {
      enforceCooldown: true,
    });

    if (otpDispatchResult.throttled) {
      res.status(429).json({
        message: `Please wait ${otpDispatchResult.retryAfterSeconds} seconds before requesting a new OTP`,
        retryAfterSeconds: otpDispatchResult.retryAfterSeconds,
      });
      return;
    }

    res.status(200).json({
      message: otpDispatchResult.sent
        ? "Verification OTP has been sent to your email"
        : "OTP generated, but email delivery failed. Please retry after SMTP is available.",
      emailVerified: false,
      otpDeliveryStatus: otpDispatchResult.sent ? "sent" : "failed",
      ...(otpDispatchResult.debugOtp
        ? { debugOtp: otpDispatchResult.debugOtp }
        : {}),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in requestEmailVerificationOtp: ", error.message);
  }
};

const verifyEmailVerificationOtp = async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const otp = String(req.body?.otp || "").trim();

    if (!email || !otp) {
      res.status(400).json({ message: "Email and OTP are required" });
      return;
    }

    if (!EMAIL_OTP_REGEX.test(otp)) {
      res.status(400).json({ message: "OTP must be a 6-digit code" });
      return;
    }

    const user = await User.findOne({ email }).select(
      "+emailVerificationOtpHash +emailVerificationOtpExpiresAt +emailVerificationOtpSentAt"
    );

    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (user.emailVerified !== false) {
      res.status(200).json({
        message: "Email is already verified",
        emailVerified: true,
      });
      return;
    }

    if (!user.emailVerificationOtpHash || !user.emailVerificationOtpExpiresAt) {
      res.status(400).json({
        message: "No active OTP found. Please request a new OTP.",
      });
      return;
    }

    if (new Date(user.emailVerificationOtpExpiresAt).getTime() < Date.now()) {
      user.emailVerificationOtpHash = undefined;
      user.emailVerificationOtpExpiresAt = undefined;
      user.emailVerificationOtpSentAt = undefined;
      await user.save();

      res.status(400).json({ message: "OTP has expired. Please request a new OTP." });
      return;
    }

    const incomingOtpHash = hashEmailVerificationOtp(otp);
    if (incomingOtpHash !== user.emailVerificationOtpHash) {
      res.status(400).json({ message: "Invalid OTP" });
      return;
    }

    user.emailVerified = true;
    user.emailVerificationOtpHash = undefined;
    user.emailVerificationOtpExpiresAt = undefined;
    user.emailVerificationOtpSentAt = undefined;
    await user.save();

    res.status(200).json({
      message: "Email verified successfully. You can now log in.",
      emailVerified: true,
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in verifyEmailVerificationOtp: ", error.message);
  }
};

export {
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
  registerPushToken,
  getWebPushPublicConfig,
  registerWebPushSubscription,
  unregisterWebPushSubscription,
};
