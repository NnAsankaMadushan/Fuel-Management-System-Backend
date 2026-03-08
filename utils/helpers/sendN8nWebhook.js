import axios from "axios";

const getWebhookUrl = () =>
  String(process.env.N8N_ACCOUNT_CREATED_WEBHOOK_URL || "").trim();

const buildWebhookHeaders = () => {
  const headers = {
    "Content-Type": "application/json",
  };

  const bearerToken = String(process.env.N8N_WEBHOOK_BEARER_TOKEN || "").trim();
  const secret = String(process.env.N8N_WEBHOOK_SECRET || "").trim();

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  if (secret) {
    headers["x-webhook-secret"] = secret;
  }

  return headers;
};

const postToWebhook = async (webhookUrl, payload) => {
  if (!webhookUrl) {
    return {
      delivered: false,
      reason: "N8N_WEBHOOK_NOT_CONFIGURED",
    };
  }

  try {
    const response = await axios.post(webhookUrl, payload, {
      headers: buildWebhookHeaders(),
    });

    return {
      delivered: response.status >= 200 && response.status < 300,
      statusCode: response.status,
      reason: "OK",
    };
  } catch (error) {
    console.log("Error in postToWebhook:", error?.message || error);
    return {
      delivered: false,
      reason: "N8N_WEBHOOK_FAILED",
      errorMessage: error?.message || "Unknown n8n webhook error",
    };
  }
};

const triggerAccountCreatedWebhook = async (user) => {
  const webhookUrl = getWebhookUrl();

  const payload = {
    event: "account_created",
    occurredAt: new Date().toISOString(),
    user: {
      id: user?._id?.toString?.() || "",
      name: user?.name || "",
      email: user?.email || "",
      role: user?.role || "",
      phoneNumber: user?.phoneNumber || "",
      nicNumber: user?.nicNumber || "",
    },
  };

  return postToWebhook(webhookUrl, payload);
};

const triggerFuelDispensedWebhook = async ({
  user,
  vehicle,
  station,
  transaction,
  quota,
}) => {
  const webhookUrl = String(
    process.env.N8N_FUEL_DISPENSED_WEBHOOK_URL ||
      process.env.N8N_ACCOUNT_CREATED_WEBHOOK_URL ||
      ""
  ).trim();

  const payload = {
    event: "fuel_dispensed",
    occurredAt: new Date().toISOString(),
    user: {
      id: user?._id?.toString?.() || "",
      name: user?.name || "",
      email: user?.email || "",
      phoneNumber: user?.phoneNumber || "",
    },
    vehicle: {
      id: vehicle?._id?.toString?.() || "",
      vehicleNumber: vehicle?.vehicleNumber || "",
      fuelType: vehicle?.fuelType || "",
    },
    station: {
      id: station?._id?.toString?.() || "",
      stationName: station?.stationName || "",
    },
    transaction: {
      id: transaction?._id?.toString?.() || "",
      litresPumped: Number(transaction?.litresPumped || 0),
      fuelType: transaction?.fuelType || "",
      createdAt:
        transaction?.createdAt instanceof Date
          ? transaction.createdAt.toISOString()
          : new Date().toISOString(),
    },
    quota: {
      reducedQuota: Number(quota?.reducedQuota || 0),
      availableQuota: Number(quota?.availableQuota || 0),
      quotaBefore: Number(quota?.quotaBefore || 0),
      quotaAfter: Number(quota?.quotaAfter || 0),
      allocatedQuota: Number(quota?.allocatedQuota || 0),
      usedQuota: Number(quota?.usedQuota || 0),
    },
  };

  return postToWebhook(webhookUrl, payload);
};

export { triggerFuelDispensedWebhook };
export default triggerAccountCreatedWebhook;
