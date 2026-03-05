import FuelStation from "../models/fuelStation.js";
import User from "../models/user.js";
import bcrypt from "bcryptjs";
import { normalizeNicNumber } from "../utils/helpers/normalizeNicNumber.js";

// import { protectRoute, authorizeRole } from "../middleware/protectRoute.js"; // Import protectRoute and authorizeRole middleware

const parseOptionalFuelAmount = (value, label) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    const error = new Error(`${label} must be a non-negative number`);
    error.statusCode = 400;
    throw error;
  }

  return parsedValue;
};

const normalizeOptionalText = (value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue || undefined;
};

// Signup a new fuel station
const registerStation = async (req, res) => {
  try {
    const stationName = normalizeOptionalText(req.body.stationName);
    const location = normalizeOptionalText(req.body.location);
    const station_regNumber = normalizeOptionalText(req.body.station_regNumber);
    const availablePetrol = parseOptionalFuelAmount(
      req.body.availablePetrol,
      "Available petrol"
    );
    const availableDiesel = parseOptionalFuelAmount(
      req.body.availableDiesel,
      "Available diesel"
    );

    if (!stationName || !location || !station_regNumber) {
      return res.status(400).json({
        message: "Station name, location, and registration number are required",
      });
    }

    const user = req.user; // User retrieved from protectRoute middleware
    if (user.role !== "station_owner") {
      return res
        .status(403)
        .json({ message: "You are not authorized to sign up a fuel station" });
    }

    const existingStation = await FuelStation.findOne({ station_regNumber });
    if (existingStation) {
      return res.status(400).json({ message: "Station already exists" });
    }

    // Create new station
    const newStation = new FuelStation({
      fuelStationOwner: user._id, // Set fuelStationOwner to userId from found user
      stationName,
      location,
      station_regNumber,
      availablePetrol: availablePetrol ?? 0,
      availableDiesel: availableDiesel ?? 0,
    });

    await newStation.save();

    res.status(201).json({
      _id: newStation._id,
      stationName: newStation.stationName,
      stationOwner: newStation.fuelStationOwner,
      location: newStation.location,
      station_regNumber: newStation.station_regNumber,
      availablePetrol: newStation.availablePetrol,
      availableDiesel: newStation.availableDiesel,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
    console.log("Error in registerStation: ", error.message);
  }
};

// Update a station based on station_regNumber
const updateStation = async (req, res) => {
  try {
    const stationName = normalizeOptionalText(req.body.stationName);
    const location = normalizeOptionalText(req.body.location);
    const station_regNumber = normalizeOptionalText(req.body.station_regNumber);
    const availablePetrol = parseOptionalFuelAmount(
      req.body.availablePetrol,
      "Available petrol"
    );
    const availableDiesel = parseOptionalFuelAmount(
      req.body.availableDiesel,
      "Available diesel"
    );
    const stationRegNumber = req.params.station_regNumber; // Get station_regNumber from URL parameter

    // Find the station by its registration number
    let station = await FuelStation.findOne({
      station_regNumber: stationRegNumber,
    });
    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    // Ensure the user is authorized and is the owner of the station
    const user = req.user; // User retrieved from protectRoute middleware
    if (!station.fuelStationOwner.equals(user._id)) {
      return res
        .status(403)
        .json({ message: "You are not authorized to update this station" });
    }

    // Update station details
    if (stationName) {
      station.stationName = stationName;
    }
    if (location) {
      station.location = location;
    }
    if (station_regNumber) {
      station.station_regNumber = station_regNumber;
    }
    if (availablePetrol !== undefined) {
      station.availablePetrol = availablePetrol;
    }
    if (availableDiesel !== undefined) {
      station.availableDiesel = availableDiesel;
    }

    // Save updated station
    station = await station.save();

    res.status(200).json({
      station: {
        _id: station._id,
        stationName: station.stationName,
        stationOwner: station.fuelStationOwner,
        location: station.location,
        station_regNumber: station.station_regNumber,
        availablePetrol: station.availablePetrol,
        availableDiesel: station.availableDiesel,
      },
      message: "Station updated successfully",
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ message: error.message });
    console.log("Error in updateStation: ", error.message);
  }
};

// Get station details by ID
const getStationById = async (req, res) => {
  const stationId = req.params.id;

  try {
    const station = await FuelStation.findById(stationId)
      .populate("fuelStationOwner", "name email")
      .populate("stationOperators", "name email phoneNumber nicNumber role")
      .populate(`registeredVehicles.vehicle`, "vehicleNumber vehicleType");
    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    res.status(200).json(station);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getStationById: ", error.message);
  }
};

// Get all stations
const getAllStations = async (req, res) => {
  try {
    const stations = await FuelStation.find({})
      .sort({ createdAt: -1, _id: -1 })
      .populate("fuelStationOwner", "name email")
      .populate("stationOperators", "name email phoneNumber nicNumber role")
      .populate(`registeredVehicles.vehicle`, "vehicleNumber vehicleType");
    res.status(200).json(stations);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getAllStations: ", error.message);
  }
};

const addStationOperator = async (req, res) => {
  try {
    const { name, email, password, phoneNumber } = req.body;
    const nicNumber = normalizeNicNumber(req.body.nicNumber);
    const role = "station_operator";

    if (!name || !email || !password || !phoneNumber || !nicNumber) {
      return res.status(400).json({
        message:
          "Name, email, password, phone number, and NIC number are required",
      });
    }

    const user = req.user;
    if (user.role !== "station_owner") {
      return res
        .status(403)
        .json({ message: "You are not authorized to add a station operator" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "User already exists" });
    }

    const existingNic = await User.findOne({ nicNumber });
    if (existingNic) {
      return res.status(400).json({ message: "A user with this NIC number already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newOperator = new User({
      name,
      email,
      password: hashedPassword,
      role,
      phoneNumber,
      nicNumber,
      mustChangePassword: true,
    });

    await newOperator.save();

    const fuelStation = await FuelStation.findOne({
      fuelStationOwner: user._id,
    });

    if (!fuelStation) {
      return res.status(404).json({ message: "Station not found" });
    }

    fuelStation.stationOperators.push(newOperator._id);
    await fuelStation.save();

    if (newOperator) {
      res.status(201).json({
        _id: newOperator._id,
        name: newOperator.name,
        email: newOperator.email,
        role: newOperator.role,
        phoneNumber: newOperator.phoneNumber,
        nicNumber: newOperator.nicNumber,
        mustChangePassword: newOperator.mustChangePassword,
        message:
          "Operator account created successfully. The user must change the temporary password on first login.",
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.nicNumber) {
      res.status(400).json({ message: "A user with this NIC number already exists" });
      return;
    }

    res.status(500).json({ message: error.message });
    console.log("Error in addStationOperator: ", error.message);
  }
};

// delete a station operator
const deleteStationOperator = async (req, res) => {
  try {
    const stationOperatorId = req.params.id;
    const user = req.user;

    const operator = await User.findById(stationOperatorId);
    if (!operator) {
      return res.status(404).json({ message: "Operator not found" });
    }

    // Ensure the user is authorized and is the owner of the station
    if (user.role !== "station_owner") {
      return res
        .status(403)
        .json({ message: "You are not authorized to delete this operator" });
    }

    await operator.remove();

    const fuelStation = await FuelStation.findOne({
      fuelStationOwner: user._id,
    });

    if (!fuelStation) {
      return res.status(404).json({ message: "Station not found" });
    }

    fuelStation.stationOperators = fuelStation.stationOperators.filter(
      (operatorId) => !operatorId.equals(operator._id)
    );
    await fuelStation.save();

    res.status(200).json({ message: "Operator removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in deleteStationOperator: ", error.message);
  }
};

// Get all station operators for particular station owner
const getAllStationOperators = async (req, res) => {
  try {
    const user = req.user;
    const fuelStation = await FuelStation.findOne({
      fuelStationOwner: user._id,
    });

    if (!fuelStation) {
      return res.status(404).json({ message: "Station not found" });
    }

    // exclude password field, createdAt, updatedAt
    const operators = await User.find(
      { _id: { $in: fuelStation.stationOperators } },
      "-password -createdAt -__v"
    )
    res.status(200).json(operators);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getAllStationOperators: ", error.message);
  }
};

// delete a station
const deleteStation = async (req, res) => {
  try {
    const stationId = req.params.id;
    const user = req.user;

    const station = await FuelStation.findById(stationId);
    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    await station.remove();
    res.status(200).json({ message: "Station removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in deleteStation: ", error.message);
  }
};

const getAllStaionsByUserId = async (req, res) => {
  try {
    const user = req.user;
    const stations = await FuelStation.find({ fuelStationOwner: user._id })
      .populate("fuelStationOwner", "name email")
      .populate("stationOperators", "name email phoneNumber nicNumber role")
      .populate(`registeredVehicles.vehicle`, "vehicleNumber vehicleType");
    res.status(200).json(stations);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getAllStaionsByUserId: ", error.message);
  }
};


export {
  registerStation,
  updateStation,
  getStationById,
  getAllStations,
  addStationOperator,
  deleteStationOperator,
  deleteStation,
  getAllStationOperators,
  getAllStaionsByUserId,
}; // Export the functions
