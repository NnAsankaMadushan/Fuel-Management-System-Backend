import mongoose from "mongoose";
import { Expo } from "expo-server-sdk";
import webpush from "web-push";
import Notification from "../../models/notification.js";
import User from "../../models/user.js";
import { normalizeUserRole } from "./normalizeUserRole.js";

const expoClient = new Expo();

const ALLOWED_NOTIFICATION_TYPES = new Set([
  "vehicle_approval",
  "fuel_transaction",
  "account_event",
  "system_alert",
]);

const ALLOWED_NOTIFICATION_STATUSES = new Set([
  "pending",
  "approved",
  "rejected",
  "completed",
]);

const normalizeNotificationType = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "system_alert";
  }

  return ALLOWED_NOTIFICATION_TYPES.has(normalized)
    ? normalized
    : "system_alert";
};

const normalizeNotificationStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "completed";
  }

  return ALLOWED_NOTIFICATION_STATUSES.has(normalized)
    ? normalized
    : "completed";
};

const getWebPushConfigState = () => {
  const vapidPublicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim();
  const vapidPrivateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim();
  const vapidSubject = String(process.env.WEB_PUSH_VAPID_SUBJECT || "").trim();

  return {
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject,
    enabled: Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject),
  };
};

const normalizeWebPushSubscription = (entry = {}) => {
  const endpoint = String(entry?.endpoint || "").trim();
  const p256dh = String(entry?.keys?.p256dh || "").trim();
  const auth = String(entry?.keys?.auth || "").trim();
  const incomingExpiration = entry?.expirationTime;
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

const getHomeRouteForRole = (role) => {
  switch (normalizeUserRole(role)) {
    case "vehicle_owner":
      return "/vehicleHome";
    case "station_owner":
      return "/s-home";
    case "station_operator":
      return "/o-home";
    case "admin":
      return "/admin";
    default:
      return "/";
  }
};

const pushToExpo = async ({ tokens = [], title, body, data = {} }) => {
  const dedupedTokens = [...new Set(tokens.map((token) => String(token || "").trim()))];
  const expoTokens = dedupedTokens.filter((token) => Expo.isExpoPushToken(token));

  if (!expoTokens.length) {
    return {
      dispatched: 0,
      invalidTokenCount: dedupedTokens.length,
    };
  }

  const messages = expoTokens.map((to) => ({
    to,
    sound: "default",
    title,
    body,
    data,
  }));

  let dispatched = 0;
  const chunks = expoClient.chunkPushNotifications(messages);

  for (const chunk of chunks) {
    try {
      await expoClient.sendPushNotificationsAsync(chunk);
      dispatched += chunk.length;
    } catch (error) {
      console.log("Error in pushToExpo chunk dispatch:", error?.message || error);
    }
  }

  return {
    dispatched,
    invalidTokenCount: dedupedTokens.length - expoTokens.length,
  };
};

const pushToWeb = async ({ subscriptions = [], title, body, data = {} }) => {
  const seenEndpoints = new Set();
  const normalizedSubscriptions = [];

  for (const entry of Array.isArray(subscriptions) ? subscriptions : []) {
    const subscription = normalizeWebPushSubscription(entry);

    if (!subscription || seenEndpoints.has(subscription.endpoint)) {
      continue;
    }

    seenEndpoints.add(subscription.endpoint);
    normalizedSubscriptions.push(subscription);
  }

  const invalidSubscriptionCount =
    (Array.isArray(subscriptions) ? subscriptions.length : 0) -
    normalizedSubscriptions.length;
  const webPushConfig = getWebPushConfigState();

  if (!normalizedSubscriptions.length) {
    return {
      dispatched: 0,
      invalidSubscriptionCount,
      staleEndpoints: [],
      configured: webPushConfig.enabled,
    };
  }

  if (!webPushConfig.enabled) {
    return {
      dispatched: 0,
      invalidSubscriptionCount,
      staleEndpoints: [],
      configured: false,
    };
  }

  webpush.setVapidDetails(
    webPushConfig.vapidSubject,
    webPushConfig.vapidPublicKey,
    webPushConfig.vapidPrivateKey
  );

  let dispatched = 0;
  const staleEndpoints = [];
  const payload = JSON.stringify({
    title,
    body,
    data,
  });

  const sendResults = await Promise.allSettled(
    normalizedSubscriptions.map((subscription) =>
      webpush.sendNotification(subscription, payload, {
        TTL: 120,
        urgency: "high",
      })
    )
  );

  sendResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      dispatched += 1;
      return;
    }

    const statusCode = Number(result.reason?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      staleEndpoints.push(normalizedSubscriptions[index].endpoint);
      return;
    }

    console.log(
      "Error in pushToWeb dispatch:",
      result.reason?.message || result.reason
    );
  });

  return {
    dispatched,
    invalidSubscriptionCount,
    staleEndpoints: [...new Set(staleEndpoints)],
    configured: true,
  };
};

const createNotificationError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sendUserNotification = async ({
  userId = "",
  email = "",
  title,
  message,
  type = "system_alert",
  status = "completed",
  vehicleId = "",
  targetPath = "",
} = {}) => {
  const normalizedUserId = String(userId || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedTitle = String(title || "").trim();
  const normalizedMessage = String(message || "").trim();
  const normalizedType = normalizeNotificationType(type);
  const normalizedStatus = normalizeNotificationStatus(status);
  const normalizedVehicleId = String(vehicleId || "").trim();

  if (!normalizedTitle || !normalizedMessage) {
    throw createNotificationError("title and message are required", 400);
  }

  if (!normalizedUserId && !normalizedEmail) {
    throw createNotificationError("userId or email is required", 400);
  }

  let user = null;
  if (normalizedUserId) {
    if (!mongoose.Types.ObjectId.isValid(normalizedUserId)) {
      throw createNotificationError("Invalid userId", 400);
    }

    user = await User.findById(normalizedUserId).select(
      "_id email role pushTokens webPushSubscriptions"
    );
  }

  if (!user && normalizedEmail) {
    user = await User.findOne({ email: normalizedEmail }).select(
      "_id email role pushTokens webPushSubscriptions"
    );
  }

  if (!user) {
    throw createNotificationError("Target user not found", 404);
  }

  const notificationPayload = {
    user: user._id,
    type: normalizedType,
    title: normalizedTitle,
    message: normalizedMessage,
    status: normalizedStatus,
  };

  if (normalizedVehicleId && mongoose.Types.ObjectId.isValid(normalizedVehicleId)) {
    notificationPayload.vehicle = normalizedVehicleId;
  }

  const notification = await Notification.create(notificationPayload);
  const resolvedTargetPath =
    String(targetPath || "").trim() ||
    (notificationPayload.vehicle &&
    normalizeUserRole(user.role) === "vehicle_owner"
      ? `/vehicle/${notificationPayload.vehicle}`
      : getHomeRouteForRole(user.role));

  const [pushResult, webPushResult] = await Promise.all([
    pushToExpo({
      tokens: Array.isArray(user.pushTokens) ? user.pushTokens : [],
      title: normalizedTitle,
      body: normalizedMessage,
      data: {
        notificationId: notification._id.toString(),
        type: normalizedType,
        status: normalizedStatus,
        url: resolvedTargetPath,
      },
    }),
    pushToWeb({
      subscriptions: Array.isArray(user.webPushSubscriptions)
        ? user.webPushSubscriptions
        : [],
      title: normalizedTitle,
      body: normalizedMessage,
      data: {
        notificationId: notification._id.toString(),
        type: normalizedType,
        status: normalizedStatus,
        url: resolvedTargetPath,
      },
    }),
  ]);

  if (webPushResult.staleEndpoints.length) {
    user.webPushSubscriptions = (
      Array.isArray(user.webPushSubscriptions) ? user.webPushSubscriptions : []
    ).filter(
      (entry) =>
        !webPushResult.staleEndpoints.includes(String(entry?.endpoint || "").trim())
    );
    await user.save();
  }

  return {
    user,
    notification,
    targetPath: resolvedTargetPath,
    pushResult,
    webPushResult,
  };
};

export {
  getHomeRouteForRole,
  normalizeNotificationStatus,
  normalizeNotificationType,
  sendUserNotification,
};
