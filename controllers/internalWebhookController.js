import {
  normalizeNotificationStatus,
  normalizeNotificationType,
  sendUserNotification,
} from "../utils/helpers/sendUserNotification.js";
import FuelStation from "../models/fuelStation.js";
import FuelTransaction from "../models/fuelTransaction.js";
import { getStationVerificationStatus, isStationApproved } from "../utils/helpers/stationApproval.js";

const DEFAULT_REPORT_TIMEZONE =
  String(process.env.CRON_TIMEZONE || "").trim() ||
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  "UTC";

const formatNumber = (value) =>
  Number(Number(value || 0).toFixed(2)).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

const formatLitres = (value) => `${formatNumber(value)} L`;

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getDateFormatter = (timeZone) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

const formatDateKeyInTimeZone = (value, timeZone) => {
  const parts = getDateFormatter(timeZone).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";

  return `${year}-${month}-${day}`;
};

const shiftDateKey = (dateKey, days) => {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }

  const [, year, month, day] = match;
  const shifted = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day) + days)
  );

  return `${shifted.getUTCFullYear()}-${String(
    shifted.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
};

const parseTimeZoneOffsetMinutes = (value = "") => {
  const normalized = String(value || "").trim().toUpperCase();

  if (!normalized || normalized === "GMT" || normalized === "UTC") {
    return 0;
  }

  const match = normalized.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return 0;
  }

  const [, sign, hours, minutes = "0"] = match;
  const totalMinutes = Number(hours) * 60 + Number(minutes);

  return sign === "-" ? -totalMinutes : totalMinutes;
};

const getTimeZoneOffsetMinutes = (value, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(value);

  const timeZoneName =
    parts.find((part) => part.type === "timeZoneName")?.value || "UTC";

  return parseTimeZoneOffsetMinutes(timeZoneName);
};

const getUtcDateForLocalMidnight = (dateKey, timeZone) => {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const utcGuess = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0)
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);

  return new Date(utcGuess.getTime() - offsetMinutes * 60 * 1000);
};

const resolveReportDateKey = (requestedDate, timeZone) => {
  const normalizedRequestedDate = String(requestedDate || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedRequestedDate)) {
    return normalizedRequestedDate;
  }

  const todayKey = formatDateKeyInTimeZone(new Date(), timeZone);
  return shiftDateKey(todayKey, -1);
};

const formatReportDateLabel = (dateKey, timeZone) => {
  const startDate = getUtcDateForLocalMidnight(dateKey, timeZone);

  if (!startDate) {
    return dateKey;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(startDate);
};

const formatDateTimeForEmail = (value, timeZone) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);

const buildDailySummaryNotificationMessage = (summary) => {
  if (summary.totalTransactions > 0) {
    return `${summary.totalTransactions} transactions, ${formatLitres(
      summary.totalLitresDispensed
    )} dispensed across ${summary.totalStations} station(s).`;
  }

  return `No fuel transactions were recorded across ${summary.totalStations} station(s).`;
};

const buildStationBreakdownText = (stations) =>
  stations
    .map(
      (station, index) =>
        `${index + 1}. ${station.stationName} (${station.status})\n` +
        `   Transactions: ${station.totalTransactions}\n` +
        `   Litres dispensed: ${formatLitres(station.totalLitresDispensed)}\n` +
        `   Current stock: Petrol ${formatLitres(
          station.availablePetrol
        )}, Diesel ${formatLitres(station.availableDiesel)}`
    )
    .join("\n\n");

const buildRecentTransactionsText = (transactions, timeZone) => {
  if (!transactions.length) {
    return "No fuel transactions were recorded for this period.";
  }

  return transactions
    .map(
      (transaction) =>
        `- ${formatDateTimeForEmail(transaction.createdAt, timeZone)} | ${
          transaction.vehicleNumber
        } | ${formatLitres(transaction.litresPumped)} ${transaction.fuelType} | ${
          transaction.stationName
        }`
    )
    .join("\n");
};

const buildDailySummaryEmail = ({
  owner,
  reportDate,
  reportDateLabel,
  timeZone,
  summary,
}) => {
  const subject = `Daily station summary - ${reportDateLabel}`;
  const notifyTitle = `Daily station summary - ${reportDate}`;
  const notifyMessage = buildDailySummaryNotificationMessage(summary);
  const stationBreakdownText = buildStationBreakdownText(summary.stationBreakdown);
  const recentTransactionsText = buildRecentTransactionsText(
    summary.recentTransactions,
    timeZone
  );
  const stationRowsHtml = summary.stationBreakdown
    .map(
      (station) => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(
            station.stationName
          )}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(
            station.status
          )}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${
            station.totalTransactions
          }</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${escapeHtml(
            formatLitres(station.totalLitresDispensed)
          )}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${escapeHtml(
            formatLitres(station.availablePetrol)
          )}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">${escapeHtml(
            formatLitres(station.availableDiesel)
          )}</td>
        </tr>`
    )
    .join("");
  const recentTransactionsHtml = summary.recentTransactions.length
    ? `<ul style="padding-left: 18px; margin: 0;">
        ${summary.recentTransactions
          .map(
            (transaction) => `
              <li style="margin-bottom: 8px;">
                ${escapeHtml(
                  formatDateTimeForEmail(transaction.createdAt, timeZone)
                )} | ${escapeHtml(transaction.vehicleNumber)} | ${escapeHtml(
                  formatLitres(transaction.litresPumped)
                )} ${escapeHtml(transaction.fuelType)} | ${escapeHtml(
                  transaction.stationName
                )}
              </li>`
          )
          .join("")}
      </ul>`
    : `<p style="margin: 0; color: #4b5563;">No fuel transactions were recorded for this period.</p>`;

  const text = `Hi ${owner.name},

Here is your station summary for ${reportDateLabel} (${timeZone}).

Overview
- Stations: ${summary.totalStations} total, ${summary.approvedStations} approved
- Operators: ${summary.totalOperators}
- Registered vehicles: ${summary.totalRegisteredVehicles}

Daily activity
- Transactions: ${summary.totalTransactions}
- Litres dispensed: ${formatLitres(summary.totalLitresDispensed)}
- Petrol dispensed: ${formatLitres(summary.fuelBreakdown.petrol)}
- Diesel dispensed: ${formatLitres(summary.fuelBreakdown.diesel)}

Current stock snapshot
- Petrol: ${formatLitres(summary.stockSnapshot.availablePetrol)}
- Diesel: ${formatLitres(summary.stockSnapshot.availableDiesel)}

Station breakdown
${stationBreakdownText || "No stations available."}

Recent transactions
${recentTransactionsText}
`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827; max-width: 760px;">
      <p>Hi ${escapeHtml(owner.name)},</p>
      <p>Here is your station summary for <strong>${escapeHtml(
        reportDateLabel
      )}</strong> (${escapeHtml(timeZone)}).</p>

      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 20px 0;">
        <div style="padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <strong style="display: block; font-size: 18px;">${summary.totalTransactions}</strong>
          <span style="color: #4b5563;">Transactions</span>
        </div>
        <div style="padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <strong style="display: block; font-size: 18px;">${escapeHtml(
            formatLitres(summary.totalLitresDispensed)
          )}</strong>
          <span style="color: #4b5563;">Litres dispensed</span>
        </div>
        <div style="padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <strong style="display: block; font-size: 18px;">${escapeHtml(
            formatLitres(summary.stockSnapshot.availablePetrol)
          )}</strong>
          <span style="color: #4b5563;">Current petrol stock</span>
        </div>
        <div style="padding: 14px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <strong style="display: block; font-size: 18px;">${escapeHtml(
            formatLitres(summary.stockSnapshot.availableDiesel)
          )}</strong>
          <span style="color: #4b5563;">Current diesel stock</span>
        </div>
      </div>

      <h2 style="margin: 24px 0 8px; font-size: 18px;">Overview</h2>
      <ul style="padding-left: 18px; margin: 0 0 16px;">
        <li>${summary.totalStations} station(s), ${summary.approvedStations} approved</li>
        <li>${summary.totalOperators} operator account(s)</li>
        <li>${summary.totalRegisteredVehicles} registered vehicle record(s)</li>
        <li>Petrol dispensed: ${escapeHtml(
          formatLitres(summary.fuelBreakdown.petrol)
        )}</li>
        <li>Diesel dispensed: ${escapeHtml(
          formatLitres(summary.fuelBreakdown.diesel)
        )}</li>
      </ul>

      <h2 style="margin: 24px 0 8px; font-size: 18px;">Station breakdown</h2>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
        <thead style="background: #f9fafb;">
          <tr>
            <th style="padding: 10px 12px; text-align: left;">Station</th>
            <th style="padding: 10px 12px; text-align: left;">Status</th>
            <th style="padding: 10px 12px; text-align: right;">Transactions</th>
            <th style="padding: 10px 12px; text-align: right;">Dispensed</th>
            <th style="padding: 10px 12px; text-align: right;">Petrol stock</th>
            <th style="padding: 10px 12px; text-align: right;">Diesel stock</th>
          </tr>
        </thead>
        <tbody>
          ${stationRowsHtml || `
            <tr>
              <td colspan="6" style="padding: 14px; text-align: center; color: #4b5563;">No stations available.</td>
            </tr>`}
        </tbody>
      </table>

      <h2 style="margin: 24px 0 8px; font-size: 18px;">Recent transactions</h2>
      ${recentTransactionsHtml}
    </div>
  `;

  return {
    to: owner.email,
    subject,
    text,
    html,
    notifyTitle,
    notifyMessage,
    notifyType: "system_alert",
    notifyStatus: "completed",
  };
};

const getN8nAuthConfig = () => ({
  secret: String(process.env.N8N_WEBHOOK_SECRET || "").trim(),
  bearerToken: String(process.env.N8N_WEBHOOK_BEARER_TOKEN || "").trim(),
});

const authorizeN8nRequest = (req, res) => {
  const { secret, bearerToken } = getN8nAuthConfig();
  const incomingSecret = String(req.get("x-webhook-secret") || "").trim();
  const incomingAuthorization = String(req.get("authorization") || "").trim();
  const incomingBearerToken = incomingAuthorization.startsWith("Bearer ")
    ? incomingAuthorization.slice(7).trim()
    : "";

  if (!secret && !bearerToken) {
    res.status(503).json({
      message: "N8N webhook secret or bearer token is not configured",
    });
    return false;
  }

  const secretMatched = Boolean(secret && incomingSecret && incomingSecret === secret);
  const bearerMatched = Boolean(
    bearerToken && incomingBearerToken && incomingBearerToken === bearerToken
  );

  if (!secretMatched && !bearerMatched) {
    res.status(401).json({ message: "Unauthorized webhook request" });
    return false;
  }

  return true;
};

const receiveN8nNotification = async (req, res) => {
  try {
    if (!authorizeN8nRequest(req, res)) {
      return;
    }

    const userId = String(req.body?.userId || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const title = String(req.body?.title || "").trim();
    const message = String(req.body?.message || "").trim();
    const type = normalizeNotificationType(req.body?.type);
    const status = normalizeNotificationStatus(req.body?.status);
    const vehicleId = String(req.body?.vehicleId || "").trim();

    if (!title || !message) {
      res.status(400).json({ message: "title and message are required" });
      return;
    }

    if (!userId && !email) {
      res.status(400).json({ message: "userId or email is required" });
      return;
    }

    const { notification, pushResult, webPushResult } = await sendUserNotification({
      userId,
      email,
      title,
      message,
      type,
      status,
      vehicleId,
    });

    res.status(201).json({
      message: "Notification created",
      notificationId: notification._id,
      pushDispatched: pushResult.dispatched,
      invalidTokenCount: pushResult.invalidTokenCount,
      webPushDispatched: webPushResult.dispatched,
      invalidWebPushSubscriptionCount: webPushResult.invalidSubscriptionCount,
      webPushConfigured: webPushResult.configured,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
    console.log("Error in receiveN8nNotification:", error?.message || error);
  }
};

const getStationOwnerDailySummaries = async (req, res) => {
  try {
    if (!authorizeN8nRequest(req, res)) {
      return;
    }

    const timeZone = String(req.query?.timeZone || DEFAULT_REPORT_TIMEZONE).trim() ||
      DEFAULT_REPORT_TIMEZONE;
    const reportDate = resolveReportDateKey(req.query?.date, timeZone);
    const nextReportDate = shiftDateKey(reportDate, 1);
    const startDate = getUtcDateForLocalMidnight(reportDate, timeZone);
    const endDate = getUtcDateForLocalMidnight(nextReportDate, timeZone);

    if (!startDate || !endDate) {
      res.status(400).json({ message: "Invalid report date" });
      return;
    }

    const reportDateLabel = formatReportDateLabel(reportDate, timeZone);
    const stations = await FuelStation.find({})
      .populate("fuelStationOwner", "name email role")
      .lean();

    const validStations = stations.filter(
      (station) =>
        station?.fuelStationOwner?._id &&
        String(station.fuelStationOwner?.email || "").trim()
    );
    const stationIds = validStations.map((station) => station._id);

    const transactions = stationIds.length
      ? await FuelTransaction.find({
          fuelStation: { $in: stationIds },
          createdAt: { $gte: startDate, $lt: endDate },
        })
          .populate("vehicle", "vehicleNumber")
          .sort({ createdAt: -1 })
          .lean()
      : [];

    const transactionsByStationId = transactions.reduce((accumulator, transaction) => {
      const stationId = String(transaction.fuelStation || "");
      if (!stationId) {
        return accumulator;
      }

      if (!accumulator.has(stationId)) {
        accumulator.set(stationId, []);
      }

      accumulator.get(stationId).push(transaction);
      return accumulator;
    }, new Map());

    const stationsByOwnerId = validStations.reduce((accumulator, station) => {
      const ownerId = String(station.fuelStationOwner?._id || "");
      if (!ownerId) {
        return accumulator;
      }

      if (!accumulator.has(ownerId)) {
        accumulator.set(ownerId, []);
      }

      accumulator.get(ownerId).push(station);
      return accumulator;
    }, new Map());

    const stationOwners = [...stationsByOwnerId.entries()]
      .map(([ownerId, ownerStations]) => {
        const owner = ownerStations[0]?.fuelStationOwner;
        const stationBreakdown = ownerStations
          .map((station) => {
            const stationTransactions =
              transactionsByStationId.get(String(station._id)) || [];
            const fuelTotals = stationTransactions.reduce(
              (accumulator, transaction) => {
                const litres = Number(transaction.litresPumped || 0);
                if (String(transaction.fuelType || "").trim().toLowerCase() === "diesel") {
                  accumulator.diesel += litres;
                } else {
                  accumulator.petrol += litres;
                }
                return accumulator;
              },
              { petrol: 0, diesel: 0 }
            );
            const lastTransaction = stationTransactions[0] || null;

            return {
              stationId: String(station._id),
              stationName: station.stationName || "Unnamed station",
              location: station.location || "",
              stationRegNumber: station.station_regNumber || "",
              status: getStationVerificationStatus(station),
              operatorsCount: Array.isArray(station.stationOperators)
                ? station.stationOperators.length
                : 0,
              registeredVehiclesCount: Array.isArray(station.registeredVehicles)
                ? station.registeredVehicles.length
                : 0,
              availablePetrol: Number(station.availablePetrol || 0),
              availableDiesel: Number(station.availableDiesel || 0),
              totalTransactions: stationTransactions.length,
              totalLitresDispensed: stationTransactions.reduce(
                (sum, transaction) => sum + Number(transaction.litresPumped || 0),
                0
              ),
              petrolLitresDispensed: fuelTotals.petrol,
              dieselLitresDispensed: fuelTotals.diesel,
              lastTransactionAt: lastTransaction?.createdAt || null,
            };
          })
          .sort((left, right) => {
            if (right.totalLitresDispensed !== left.totalLitresDispensed) {
              return right.totalLitresDispensed - left.totalLitresDispensed;
            }
            return left.stationName.localeCompare(right.stationName);
          });

        const ownerTransactions = ownerStations
          .flatMap((station) => transactionsByStationId.get(String(station._id)) || [])
          .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

        const summary = {
          totalStations: ownerStations.length,
          approvedStations: ownerStations.filter(isStationApproved).length,
          totalOperators: ownerStations.reduce(
            (sum, station) => sum + (Array.isArray(station.stationOperators) ? station.stationOperators.length : 0),
            0
          ),
          totalRegisteredVehicles: ownerStations.reduce(
            (sum, station) =>
              sum + (Array.isArray(station.registeredVehicles) ? station.registeredVehicles.length : 0),
            0
          ),
          totalTransactions: ownerTransactions.length,
          totalLitresDispensed: ownerTransactions.reduce(
            (sum, transaction) => sum + Number(transaction.litresPumped || 0),
            0
          ),
          fuelBreakdown: ownerTransactions.reduce(
            (accumulator, transaction) => {
              const litres = Number(transaction.litresPumped || 0);
              if (String(transaction.fuelType || "").trim().toLowerCase() === "diesel") {
                accumulator.diesel += litres;
              } else {
                accumulator.petrol += litres;
              }
              return accumulator;
            },
            { petrol: 0, diesel: 0 }
          ),
          stockSnapshot: {
            availablePetrol: ownerStations.reduce(
              (sum, station) => sum + Number(station.availablePetrol || 0),
              0
            ),
            availableDiesel: ownerStations.reduce(
              (sum, station) => sum + Number(station.availableDiesel || 0),
              0
            ),
          },
          stationBreakdown,
          recentTransactions: ownerTransactions.slice(0, 5).map((transaction) => {
            const station = ownerStations.find(
              (entry) => String(entry._id) === String(transaction.fuelStation || "")
            );

            return {
              transactionId: String(transaction._id),
              createdAt: transaction.createdAt,
              stationId: String(transaction.fuelStation || ""),
              stationName: station?.stationName || "Unknown station",
              vehicleNumber: transaction.vehicle?.vehicleNumber || "Unknown vehicle",
              fuelType: transaction.fuelType || "fuel",
              litresPumped: Number(transaction.litresPumped || 0),
            };
          }),
        };
        const emailPayload = buildDailySummaryEmail({
          owner: {
            id: ownerId,
            name: owner?.name || "Station owner",
            email: String(owner?.email || "").trim(),
          },
          reportDate,
          reportDateLabel,
          timeZone,
          summary,
        });

        return {
          userId: ownerId,
          name: owner?.name || "Station owner",
          email: String(owner?.email || "").trim(),
          reportDate,
          reportDateLabel,
          reportWindow: {
            startAt: startDate.toISOString(),
            endAt: endDate.toISOString(),
            timeZone,
          },
          summary,
          emailPayload,
        };
      })
      .filter((entry) => entry.email);

    res.status(200).json({
      reportDate,
      reportDateLabel,
      reportWindow: {
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
        timeZone,
      },
      totals: {
        stationOwners: stationOwners.length,
        totalStations: stationOwners.reduce(
          (sum, owner) => sum + Number(owner.summary?.totalStations || 0),
          0
        ),
        totalTransactions: stationOwners.reduce(
          (sum, owner) => sum + Number(owner.summary?.totalTransactions || 0),
          0
        ),
        totalLitresDispensed: stationOwners.reduce(
          (sum, owner) => sum + Number(owner.summary?.totalLitresDispensed || 0),
          0
        ),
      },
      stationOwners,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
    console.log("Error in getStationOwnerDailySummaries:", error?.message || error);
  }
};

export { receiveN8nNotification, getStationOwnerDailySummaries };
