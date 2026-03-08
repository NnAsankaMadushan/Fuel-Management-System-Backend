import crypto from "crypto";
import sendEmail from "./sendEmail.js";

const EMAIL_OTP_EXPIRY_MINUTES = 10;
const EMAIL_OTP_RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_OTP_REGEX = /^[0-9]{6}$/;

const isEmailOtpDebugEnabled = () =>
  process.env.EMAIL_OTP_DEBUG === "true" &&
  process.env.NODE_ENV !== "production";

const generateEmailVerificationOtp = () =>
  crypto.randomInt(100000, 1000000).toString();

const hashEmailVerificationOtp = (otp) =>
  crypto.createHash("sha256").update(String(otp)).digest("hex");

const getOtpRetryAfterSeconds = (sentAt) => {
  if (!sentAt) {
    return 0;
  }

  const elapsedSeconds = Math.floor(
    (Date.now() - new Date(sentAt).getTime()) / 1000
  );

  return Math.max(0, EMAIL_OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
};

const buildEmailVerificationContent = (otp, recipientName = "") => {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const subject = "FuelPlus Email Verification OTP";
  const text = `${greeting}
Use the OTP below to verify your FuelPlus account:

${otp}

This OTP will expire in ${EMAIL_OTP_EXPIRY_MINUTES} minutes.
If you did not request this, please ignore this email.`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <p>${greeting}</p>
      <p>Use the OTP below to verify your FuelPlus account:</p>
      <p style="font-size: 24px; font-weight: 700; letter-spacing: 4px; margin: 16px 0;">${otp}</p>
      <p>This OTP will expire in ${EMAIL_OTP_EXPIRY_MINUTES} minutes.</p>
      <p>If you did not request this, please ignore this email.</p>
    </div>
  `;

  return { subject, text, html };
};

const issueEmailVerificationOtp = async (user, { enforceCooldown = true } = {}) => {
  const retryAfterSeconds = getOtpRetryAfterSeconds(user.emailVerificationOtpSentAt);

  if (enforceCooldown && retryAfterSeconds > 0) {
    return {
      sent: false,
      throttled: true,
      retryAfterSeconds,
    };
  }

  const otp = generateEmailVerificationOtp();
  const expiresAt = new Date(Date.now() + EMAIL_OTP_EXPIRY_MINUTES * 60 * 1000);

  user.emailVerificationOtpHash = hashEmailVerificationOtp(otp);
  user.emailVerificationOtpExpiresAt = expiresAt;
  user.emailVerificationOtpSentAt = new Date();
  await user.save();

  const emailContent = buildEmailVerificationContent(otp, user.name);
  const emailResult = await sendEmail({
    to: user.email,
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

export {
  EMAIL_OTP_EXPIRY_MINUTES,
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  EMAIL_OTP_REGEX,
  isEmailOtpDebugEnabled,
  generateEmailVerificationOtp,
  hashEmailVerificationOtp,
  getOtpRetryAfterSeconds,
  issueEmailVerificationOtp,
};
