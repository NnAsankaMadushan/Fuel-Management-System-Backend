import FuelTransaction from "../models/fuelTransaction.js";
import FuelQuota from "../models/fuelQuota.js";
import Vehicle from "../models/vehicle.js";
import User from "../models/user.js";
import FuelStation from "../models/fuelStation.js";
import mongoose from "mongoose";
import sendSMS from "../utils/helpers/sendSMS.js";
import normalizeVehicleNumber from "../utils/helpers/normalizeVehicleNumber.js";
import { isVehicleApproved } from "../utils/helpers/vehicleApproval.js";

const buildRecentDays = (days = 7) => {
  const entries = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  for (let index = 0; index < days; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    entries.push({
      key: current.toISOString().slice(0, 10),
      label: current.toLocaleDateString("en-US", { weekday: "short" }),
    });
  }

  return entries;
};

const getScopedStations = async (user) => {
  if (user.role === "station_owner") {
    return FuelStation.find({ fuelStationOwner: user._id });
  }

  if (user.role === "station_operator") {
    return FuelStation.find({ stationOperators: user._id });
  }

  return [];
};

const QR_FUEL_TYPES = new Set(["petrol", "diesel"]);
const QR_VEHICLE_TYPES = new Set(["car", "bike", "truck", "bus", "motorcycle", "motorbike"]);

const resolveVehicleNumber = ({ vehicleNumber, qrData }) => {
  const directVehicleNumber = String(vehicleNumber || "").trim();
  if (directVehicleNumber) {
    return directVehicleNumber;
  }

  const rawQrData = String(qrData || "").trim();
  if (!rawQrData) {
    return "";
  }

  const segments = rawQrData
    .split("-")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length >= 3) {
    const fuelType = segments.at(-1)?.toLowerCase();
    const vehicleType = segments.at(-2)?.toLowerCase();

    if (QR_FUEL_TYPES.has(fuelType) && QR_VEHICLE_TYPES.has(vehicleType)) {
      return segments.slice(0, -2).join("-");
    }
  }

  return rawQrData;
};

// Register a new fuel transaction
export const registerFuelTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const abortWithResponse = async (statusCode, payload) => {
      await session.abortTransaction();
      session.endSession();
      res.status(statusCode).json(payload);
    };

    const { vehicleNumber, qrData, litresPumped } = req.body;
    const pumpedLitres = Number(litresPumped);
    const resolvedVehicleNumber = resolveVehicleNumber({ vehicleNumber, qrData });
    const normalizedVehicleNumber = normalizeVehicleNumber(resolvedVehicleNumber);

    if (!normalizedVehicleNumber) {
      await abortWithResponse(400, {
        message: "Vehicle number or QR data is required",
      });
      return;
    }

    if (!Number.isFinite(pumpedLitres) || pumpedLitres <= 0) {
      await abortWithResponse(400, {
        message: "Litres pumped must be a positive number",
      });
      return;
    }

    // Find the vehicle by QR code
    const vehicle = await Vehicle.findOne({
      normalizedVehicleNumber,
    }).session(session);
    if (!vehicle) {
      await abortWithResponse(400, { message: "Vehicle not found" });
      return;
    }

    if (!isVehicleApproved(vehicle)) {
      await abortWithResponse(403, {
        message: "Vehicle is not approved for fuel transactions yet",
      });
      return;
    }

    // Find the fuel quota for the vehicle
    const fuelQuota = await FuelQuota.findOne({ vehicle: vehicle._id }).session(
      session
    );
    if (!fuelQuota) {
      await abortWithResponse(400, { message: "Fuel Quota not found" });
      return;
    }

    // Check if the remaining quota is sufficient
    if (fuelQuota.remainingQuota < pumpedLitres) {
      await abortWithResponse(400, { message: "Insufficient Quota" });
      return;
    }

    if (req.user.role !== "station_operator" && req.user.role !== "station_owner") {
      await abortWithResponse(403, { message: "Unauthorized" });
      return;
    }

    const stationQuery =
      req.user.role === "station_owner"
        ? { fuelStationOwner: req.user._id }
        : { stationOperators: req.user._id };

    // Find the fuel station where the authenticated station user is assigned
    const fuelStation = await FuelStation.findOne(stationQuery).session(session);
    if (!fuelStation) {
      await abortWithResponse(400, { message: "Fuel Station not found" });
      return;
    }

    const stockField =
      vehicle.fuelType === "diesel" ? "availableDiesel" : "availablePetrol";
    const availableFuel = Number(fuelStation[stockField] || 0);

    if (availableFuel < pumpedLitres) {
      await abortWithResponse(400, {
        message: `Insufficient ${vehicle.fuelType} available at this station`,
      });
      return;
    }

    const quotaBefore = fuelQuota.remainingQuota;
    const quotaAfter = fuelQuota.remainingQuota - pumpedLitres;

    // Create a new fuel transaction
    const newFuelTransaction = new FuelTransaction({
      vehicle: vehicle._id,
      fuelStation: fuelStation._id,
      fuelType: vehicle.fuelType,
      litresPumped: pumpedLitres,
      quotaBefore,
      quotaAfter,
      status: "completed",
    });

    await newFuelTransaction.save({ session });

    // Update the remaining quota
    fuelQuota.remainingQuota = quotaAfter;
    await fuelQuota.save({ session });

    fuelStation[stockField] = availableFuel - pumpedLitres;

    // Add the vehicle to the registeredVehicles array in the fuel station
    fuelStation.registeredVehicles.push({
      vehicle: vehicle._id,
      date: new Date(),
    });
    await fuelStation.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Send SMS to the vehicle owner
    const user = await User.findById(vehicle.vehicleOwner);

    // Send SMS to the vehicle owner
    const message = `Dear ${user.name}, ${pumpedLitres} litres of fuel has been pumped at ${fuelStation.stationName}. Your remaining quota is ${quotaAfter} litres.`;
    await sendSMS(user.phoneNumber, message);

    res.status(201).json({
      _id: newFuelTransaction._id,
      vehicle: newFuelTransaction.vehicle,
      vehicleNumber: vehicle.vehicleNumber,
      fuelStation: newFuelTransaction.fuelStation,
      stationName: fuelStation.stationName,
      fuelType: newFuelTransaction.fuelType,
      litresPumped: newFuelTransaction.litresPumped,
      quotaBefore: newFuelTransaction.quotaBefore,
      quotaAfter: newFuelTransaction.quotaAfter,
      status: newFuelTransaction.status,
      availablePetrol: fuelStation.availablePetrol,
      availableDiesel: fuelStation.availableDiesel,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: error.message });
  }
};

// Check fuel quota
export const checkFuelQuota = async (req, res) => {
  try {
    const { vehicleNumber } = req.body;
    const normalizedVehicleNumber = normalizeVehicleNumber(vehicleNumber);

    const vehicle = await Vehicle.findOne({ normalizedVehicleNumber });
    if (!vehicle) {
      res.status(400).json({ message: "Vehicle not found" });
      return;
    }

    if (!isVehicleApproved(vehicle)) {
      res.status(403).json({
        vehicle: vehicle._id,
        message: "Vehicle is pending approval and cannot access quota yet",
        status: false,
      });
      return;
    }

    const fuelQuota = await FuelQuota.findOne({ vehicle: vehicle._id });
    if (!fuelQuota) {
      res.status(400).json({ message: "Fuel Quota not found" });
      return;
    }

    const usedQuota = fuelQuota.allocatedQuota - fuelQuota.remainingQuota;
    const status = fuelQuota.remainingQuota > 0;

    res.status(200).json({
      vehicle: vehicle._id,
      remainingQuota: fuelQuota.remainingQuota,
      allocatedQuota: fuelQuota.allocatedQuota,
      usedQuota: usedQuota,
      message: status ? "Sufficient quota available" : "Insufficient quota",
      status: status
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in checkFuelQuota: ", error.message);
  }
};

export const getVehicleTransactions = async (req, res) => {
  try {
    if (req.user.role !== "vehicle_owner") {
      res.status(403).json({ message: "Unauthorized" });
      return;
    }

    const vehicles = await Vehicle.find({ vehicleOwner: req.user._id }).select("_id");
    const vehicleIds = vehicles.map((vehicle) => vehicle._id);

    if (vehicleIds.length === 0) {
      res.status(200).json([]);
      return;
    }

    const transactions = await FuelTransaction.find({ vehicle: { $in: vehicleIds } })
      .populate("fuelStation", "stationName location")
      .populate("vehicle", "vehicleNumber")
      .sort({ createdAt: -1 });

    res.status(200).json(
      transactions.map((transaction) => ({
        _id: transaction._id,
        date: transaction.createdAt,
        litresPumped: transaction.litresPumped,
        fuelType: transaction.fuelType,
        status: transaction.status,
        stationName: transaction.fuelStation?.stationName || "Unknown station",
        stationLocation: transaction.fuelStation?.location || "",
        vehicleNumber: transaction.vehicle?.vehicleNumber || "",
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getVehicleTransactions: ", error.message);
  }
};

export const getStationTransactions = async (req, res) => {
  try {
    const stations = await getScopedStations(req.user);
    const stationIds = stations.map((station) => station._id);

    if (stationIds.length === 0) {
      res.status(200).json([]);
      return;
    }

    const transactions = await FuelTransaction.find({ fuelStation: { $in: stationIds } })
      .populate("vehicle", "vehicleNumber")
      .populate("fuelStation", "stationName")
      .sort({ createdAt: -1 });

    res.status(200).json(
      transactions.map((transaction) => ({
        _id: transaction._id,
        date: transaction.createdAt,
        litresPumped: transaction.litresPumped,
        fuelType: transaction.fuelType,
        status: transaction.status,
        stationName: transaction.fuelStation?.stationName || "",
        vehicleNumber: transaction.vehicle?.vehicleNumber || "Unknown vehicle",
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getStationTransactions: ", error.message);
  }
};

export const getStationSummary = async (req, res) => {
  try {
    const stations = await getScopedStations(req.user);
    const stationIds = stations.map((station) => station._id);
    const recentDays = buildRecentDays(7);
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - 6);

    const transactions = stationIds.length
      ? await FuelTransaction.find({
          fuelStation: { $in: stationIds },
          createdAt: { $gte: startDate },
        }).sort({ createdAt: -1 })
      : [];

    const totalsByDate = transactions.reduce((accumulator, transaction) => {
      const key = transaction.createdAt.toISOString().slice(0, 10);
      accumulator[key] = (accumulator[key] || 0) + transaction.litresPumped;
      return accumulator;
    }, {});

    const chart = recentDays.map((day) => ({
      label: day.label,
      litres: totalsByDate[day.key] || 0,
      date: day.key,
    }));

    res.status(200).json({
      totalStations: stations.length,
      totalRegisteredVehicles: stations.reduce(
        (sum, station) => sum + (station.registeredVehicles?.length || 0),
        0
      ),
      totalAvailablePetrol: stations.reduce(
        (sum, station) => sum + (station.availablePetrol || 0),
        0
      ),
      totalAvailableDiesel: stations.reduce(
        (sum, station) => sum + (station.availableDiesel || 0),
        0
      ),
      totalTransactions: transactions.length,
      totalLitresDispensed: transactions.reduce(
        (sum, transaction) => sum + transaction.litresPumped,
        0
      ),
      chart,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getStationSummary: ", error.message);
  }
};

export default {
  registerFuelTransaction,
  checkFuelQuota,
  getVehicleTransactions,
  getStationTransactions,
  getStationSummary,
};
