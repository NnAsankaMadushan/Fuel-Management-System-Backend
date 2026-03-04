import Vehicle from "../models/vehicle.js";
import VehicleRegistry from "../models/vehicleRegistry.js";
import Notification from "../models/notification.js";
import generateQrCode from "../utils/helpers/generateQrCode.js";
import FuelQuota from "../models/fuelQuota.js";
import {
  formatVehicleNumber,
  normalizeVehicleNumber,
} from "../utils/helpers/normalizeVehicleNumber.js";
import {
  getVehicleVerificationStatus,
  isVehicleApproved,
} from "../utils/helpers/vehicleApproval.js";

const VEHICLE_TYPE_ALIASES = {
  motorcycle: "bike",
  motorbike: "bike",
};

const ALLOWED_VEHICLE_TYPES = ["car", "bike", "truck", "bus"];
const ALLOWED_FUEL_TYPES = ["petrol", "diesel"];
const REVIEWABLE_STATUSES = ["approved", "rejected"];

const QUOTA_BY_VEHICLE_TYPE = {
  car: 20,
  bike: 10,
  truck: 100,
  bus: 100,
};

const normalizeSelectableValue = (value, aliases = {}) => {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return aliases[normalizedValue] || normalizedValue;
};

const normalizeRegistryText = (value, { uppercase = false } = {}) => {
  const normalizedValue = String(value || "").trim();
  return uppercase ? normalizedValue.toUpperCase() : normalizedValue;
};

const normalizeApprovalNote = (value = "") => String(value || "").trim();

const extractRegistryDetails = (body = {}) => ({
  engineNumber: normalizeRegistryText(body.engineNumber, { uppercase: true }),
  chassisNumber: normalizeRegistryText(body.chassisNumber, { uppercase: true }),
});

const hasCompleteRegistryDetails = (details) =>
  Boolean(details.engineNumber && details.chassisNumber);

const getLatestFuelQuota = async (vehicleId) =>
  FuelQuota.findOne({ vehicle: vehicleId }).sort({ weekStartDate: -1, createdAt: -1 });

const mapVehicleWithQuota = async (vehicle) => {
  const fuelQuota = await getLatestFuelQuota(vehicle._id);
  const verificationStatus = getVehicleVerificationStatus(vehicle);

  return {
    _id: vehicle._id,
    vehicleOwner: vehicle.vehicleOwner?._id || vehicle.vehicleOwner,
    vehicleOwnerName: vehicle.vehicleOwner?.name,
    vehicleNumber: vehicle.vehicleNumber,
    normalizedVehicleNumber: vehicle.normalizedVehicleNumber,
    vehicleType: vehicle.vehicleType,
    fuelType: vehicle.fuelType,
    qrCode: vehicle.qrCode,
    isVerified: isVehicleApproved(vehicle),
    verificationStatus,
    approvalNote: vehicle.approvalNote || "",
    reviewedAt: vehicle.reviewedAt,
    reviewedBy: vehicle.reviewedBy
      ? {
          _id: vehicle.reviewedBy?._id || vehicle.reviewedBy,
          name: vehicle.reviewedBy?.name,
        }
      : null,
    createdAt: vehicle.createdAt,
    allocatedQuota: fuelQuota ? fuelQuota.allocatedQuota : 0,
    remainingQuota: fuelQuota ? fuelQuota.remainingQuota : 0,
    usedQuota: fuelQuota ? fuelQuota.allocatedQuota - fuelQuota.remainingQuota : 0,
  };
};

const buildDecisionCopy = (vehicleNumber, status, note) => {
  const normalizedNote = normalizeApprovalNote(note);
  const defaultApprovedNote = "Vehicle approved by admin review.";
  const defaultRejectedNote = "Vehicle rejected by admin review.";

  if (status === "approved") {
    return {
      title: "Vehicle approved",
      message:
        normalizedNote && normalizedNote !== defaultApprovedNote
        ? `Your vehicle ${vehicleNumber} has been approved. ${note}`
        : `Your vehicle ${vehicleNumber} has been approved and can now be used for fuel quota access.`,
    };
  }

  return {
    title: "Vehicle rejected",
    message:
      normalizedNote && normalizedNote !== defaultRejectedNote
      ? `Your vehicle ${vehicleNumber} has been rejected. ${note}`
      : `Your vehicle ${vehicleNumber} has been rejected by the admin review process.`,
  };
};

const createVehicleDecisionNotification = async (vehicle, status, note) => {
  const notificationCopy = buildDecisionCopy(vehicle.vehicleNumber, status, note);

  await Notification.create({
    user: vehicle.vehicleOwner?._id || vehicle.vehicleOwner,
    vehicle: vehicle._id,
    type: "vehicle_approval",
    title: notificationCopy.title,
    message: notificationCopy.message,
    status,
  });
};

const canAccessVehicle = (requestUser, vehicleOwnerId) => {
  if (requestUser.role === "admin") {
    return true;
  }

  return requestUser._id.toString() === vehicleOwnerId.toString();
};

const registerVehicle = async (req, res) => {
  try {
    const { vehicleNumber } = req.body;
    const vehicleOwner = req.user._id;
    const normalizedVehicleNumber = normalizeVehicleNumber(vehicleNumber);
    const requestedVehicleType = normalizeSelectableValue(
      req.body.vehicleType,
      VEHICLE_TYPE_ALIASES
    );
    const requestedFuelType = normalizeSelectableValue(req.body.fuelType);
    const registryDetails = extractRegistryDetails(req.body);

    if (!normalizedVehicleNumber || !requestedVehicleType || !requestedFuelType) {
      res
        .status(400)
        .json({ message: "Vehicle number, vehicle type, and fuel type are required" });
      return;
    }

    if (!ALLOWED_VEHICLE_TYPES.includes(requestedVehicleType)) {
      res.status(400).json({ message: "Invalid vehicle type selected" });
      return;
    }

    if (!ALLOWED_FUEL_TYPES.includes(requestedFuelType)) {
      res.status(400).json({ message: "Invalid fuel type selected" });
      return;
    }

    if (req.user.role !== "vehicle_owner") {
      res.status(400).json({ message: "Unauthorized" });
      return;
    }

    const vehicle = await Vehicle.findOne({ normalizedVehicleNumber });
    if (vehicle) {
      res.status(400).json({ message: "Vehicle already exists" });
      return;
    }

    let vehicleRegistry = await VehicleRegistry.findOne({
      normalizedLicensePlate: normalizedVehicleNumber,
    });

    if (!vehicleRegistry) {
      if (!hasCompleteRegistryDetails(registryDetails)) {
        res.status(400).json({
          message:
            "Vehicle is not registered in the vehicle registry. Add engine number and chassis number.",
        });
        return;
      }

      const formattedVehicleNumber = formatVehicleNumber(vehicleNumber);
      vehicleRegistry = new VehicleRegistry({
        License_Plate: formattedVehicleNumber,
        normalizedLicensePlate: normalizedVehicleNumber,
        Engine_Number: registryDetails.engineNumber,
        Chassis_Number: registryDetails.chassisNumber,
        Fuel_Type: requestedFuelType,
        Vehicle_Type: requestedVehicleType,
        Verified: false,
      });

      await vehicleRegistry.save();
    }

    const registryVehicleType = normalizeSelectableValue(
      vehicleRegistry.Vehicle_Type,
      VEHICLE_TYPE_ALIASES
    );
    const registryFuelType = normalizeSelectableValue(vehicleRegistry.Fuel_Type);

    if (
      registryVehicleType !== requestedVehicleType ||
      registryFuelType !== requestedFuelType
    ) {
      res.status(400).json({
        message:
          "Selected vehicle type or fuel type does not match the vehicle registry record",
      });
      return;
    }

    const isVerified = vehicleRegistry.Verified === true;
    const verificationStatus = isVerified ? "approved" : "pending";
    const vehicleType = registryVehicleType;
    const fuelType = registryFuelType;
    const formattedVehicleNumber =
      vehicleRegistry.License_Plate || formatVehicleNumber(vehicleNumber);
    const qrCodeData = `${formattedVehicleNumber}-${vehicleType}-${fuelType}`;
    const qrCode = await generateQrCode(qrCodeData);

    const newVehicle = new Vehicle({
      vehicleOwner,
      vehicleNumber: formattedVehicleNumber,
      normalizedVehicleNumber,
      vehicleType,
      fuelType,
      qrCode,
      isVerified,
      verificationStatus,
      approvalNote: isVerified ? "Verified against the vehicle registry." : "",
    });

    await newVehicle.save();

    const allocatedQuota = QUOTA_BY_VEHICLE_TYPE[vehicleType] || 0;
    const fuelQuota = new FuelQuota({
      vehicle: newVehicle._id,
      weekStartDate: new Date(),
      allocatedQuota,
      remainingQuota: allocatedQuota,
    });

    await fuelQuota.save();

    if (newVehicle && fuelQuota) {
      res.status(201).json({
        message: isVerified
          ? "Vehicle registered successfully."
          : "Vehicle registered and added to the registry pending verification.",
        _id: newVehicle._id,
        vehicleOwner: newVehicle.vehicleOwner,
        vehicleNumber: newVehicle.vehicleNumber,
        vehicleType: newVehicle.vehicleType,
        fuelType: newVehicle.fuelType,
        qrCode: newVehicle.qrCode,
        isVerified: newVehicle.isVerified,
        verificationStatus: newVehicle.verificationStatus,
        approvalNote: newVehicle.approvalNote,
        allocatedQuota: fuelQuota.allocatedQuota,
        remainingQuota: fuelQuota.remainingQuota,
        usedQuota: fuelQuota.allocatedQuota - fuelQuota.remainingQuota,
      });
    } else {
      res.status(400).json({ message: "Invalid vehicle data" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in registerVehicle: ", error.message);
  }
};

const getAllVehicles = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({})
      .select("-updatedAt -qrCode")
      .populate("vehicleOwner", "name");

    const transformedVehicles = vehicles.map((vehicle) => ({
      _id: vehicle._id,
      vehicleOwner: vehicle.vehicleOwner._id,
      vehicleOwnerName: vehicle.vehicleOwner.name,
      vehicleNumber: vehicle.vehicleNumber,
      vehicleType: vehicle.vehicleType,
      fuelType: vehicle.fuelType,
      isVerified: isVehicleApproved(vehicle),
      verificationStatus: getVehicleVerificationStatus(vehicle),
      approvalNote: vehicle.approvalNote || "",
      reviewedAt: vehicle.reviewedAt,
      createdAt: vehicle.createdAt,
      __v: vehicle.__v,
    }));

    res.status(200).json(transformedVehicles);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getVehicles: ", error.message);
  }
};

const getVehicleById = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id)
      .select("-updatedAt")
      .populate("vehicleOwner", "name")
      .populate("reviewedBy", "name");

    if (!vehicle) {
      res.status(404).json({ message: "Vehicle not found" });
      return;
    }

    if (!canAccessVehicle(req.user, vehicle.vehicleOwner._id)) {
      res.status(403).json({ message: "Unauthorized" });
      return;
    }

    const vehicleWithQuota = await mapVehicleWithQuota(vehicle);
    res.status(200).json(vehicleWithQuota);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getVehicleById: ", error.message);
  }
};

const reviewVehicleRegistration = async (req, res) => {
  try {
    const status = String(req.body.status || "")
      .trim()
      .toLowerCase();
    const approvalNote = normalizeApprovalNote(req.body.note);

    if (!REVIEWABLE_STATUSES.includes(status)) {
      res.status(400).json({ message: "Status must be approved or rejected" });
      return;
    }

    const vehicle = await Vehicle.findById(req.params.id).populate("vehicleOwner", "name");
    if (!vehicle) {
      res.status(404).json({ message: "Vehicle not found" });
      return;
    }

    const currentStatus = getVehicleVerificationStatus(vehicle);
    const nextNote =
      approvalNote ||
      (status === "approved"
        ? "Vehicle approved by admin review."
        : "Vehicle rejected by admin review.");

    if (currentStatus === status && (vehicle.approvalNote || "") === nextNote) {
      const responseVehicle = await Vehicle.findById(vehicle._id)
        .populate("vehicleOwner", "name")
        .populate("reviewedBy", "name");
      const vehicleWithQuota = await mapVehicleWithQuota(responseVehicle);

      res.status(200).json({
        message: `Vehicle is already ${status}.`,
        vehicle: vehicleWithQuota,
      });
      return;
    }

    vehicle.verificationStatus = status;
    vehicle.isVerified = status === "approved";
    vehicle.approvalNote = nextNote;
    vehicle.reviewedAt = new Date();
    vehicle.reviewedBy = req.user._id;
    await vehicle.save();

    await VehicleRegistry.updateOne(
      { normalizedLicensePlate: vehicle.normalizedVehicleNumber },
      { $set: { Verified: status === "approved" } }
    );

    await createVehicleDecisionNotification(vehicle, status, nextNote);

    const reviewedVehicle = await Vehicle.findById(vehicle._id)
      .populate("vehicleOwner", "name")
      .populate("reviewedBy", "name");
    const vehicleWithQuota = await mapVehicleWithQuota(reviewedVehicle);

    res.status(200).json({
      message:
        status === "approved"
          ? "Vehicle approved successfully"
          : "Vehicle rejected successfully",
      vehicle: vehicleWithQuota,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in reviewVehicleRegistration: ", error.message);
  }
};

const deleteVehicle = async (req, res) => {
  try {
    const result = await Vehicle.findByIdAndDelete(req.params.id);
    if (!result) {
      res.status(404).json({ message: "Vehicle not found" });
      return;
    }

    await FuelQuota.deleteMany({ vehicle: result._id });
    await Notification.deleteMany({ vehicle: result._id });

    res.status(200).json({ message: "Vehicle deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in deleteVehicle: ", error.message);
  }
};

const getMyVehicles = async (req, res) => {
  try {
    if (req.user.role !== "vehicle_owner") {
      res.status(400).json({ message: "Unauthorized" });
      return;
    }

    const vehicles = await Vehicle.find({ vehicleOwner: req.user._id }).populate(
      "reviewedBy",
      "name"
    );

    const vehicleDetails = await Promise.all(
      vehicles.map((vehicle) => mapVehicleWithQuota(vehicle))
    );

    res.status(200).json(vehicleDetails);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getMyVehicles: ", error.message);
  }
};

export {
  registerVehicle,
  getAllVehicles,
  getVehicleById,
  reviewVehicleRegistration,
  deleteVehicle,
  getMyVehicles,
};
