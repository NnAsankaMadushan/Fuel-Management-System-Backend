import nodemailer from "nodemailer";

const parseBoolean = (value) =>
  typeof value === "string" && value.trim().toLowerCase() === "true";

const hasSmtpConfiguration = () =>
  Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER)
  );

let transporter;

const getTransporter = () => {
  if (transporter) {
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: parseBoolean(process.env.SMTP_SECURE),
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 15000),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
};

const getFromAddress = () => {
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  const fromName = process.env.SMTP_FROM_NAME?.trim();

  if (!fromName) {
    return fromEmail;
  }

  const escapedName = fromName.replace(/"/g, '\\"');
  return `"${escapedName}" <${fromEmail}>`;
};

const sendEmail = async ({ to, subject, text, html }) => {
  if (!hasSmtpConfiguration()) {
    return {
      delivered: false,
      reason: "SMTP_NOT_CONFIGURED",
    };
  }

  try {
    const info = await getTransporter().sendMail({
      from: getFromAddress(),
      to,
      subject,
      text,
      html,
    });

    return {
      delivered: true,
      messageId: info?.messageId || "",
    };
  } catch (error) {
    console.log("Error in sendEmail:", error?.message || error);
    return {
      delivered: false,
      reason: "SMTP_SEND_FAILED",
      errorMessage: error?.message || "Unknown SMTP send error",
    };
  }
};

export default sendEmail;
