import User from "../models/user.js";
import bcrypt from "bcryptjs";
import {
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

const isMobileClient = (req) => req.get("X-Client-Platform") === "mobile";

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
    const normalizedRole = normalizeUserRole(role);
    const mobileClient = isMobileClient(req);

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

    if (!isSupportedUserRole(normalizedRole)) {
      res.status(400).json({ message: "Invalid user role" });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role: normalizedRole,
      phoneNumber,
      nicNumber,
    });

    await newUser.save();

    if (newUser) {
      const token = generateToken(newUser._id);

      if (!mobileClient) {
        setAuthCookie(res, token);
      }

      res.status(201).json({
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: normalizeUserRole(newUser.role),
        phoneNumber: newUser.phoneNumber,
        nicNumber: newUser.nicNumber,
        ...(mobileClient ? { token } : {}),
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
    console.log("Error in signupUser: ", error.message);
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
    res.cookie("jwt", "", { maxAge: 1 });
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

    user.name = name || user.name;
    user.email = email || user.email;
    user.phoneNumber = phoneNumber || user.phoneNumber;

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

    res.status(200).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        nicNumber: user.nicNumber,
      },
      message: "User updated successfully",
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
      ...(await buildStationContext(user._id, normalizeUserRole(user.role))),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getCurrentUser: ", error.message);
  }
};

export { signupUser, loginUser, logoutUser, updateUser, getUserProfile, getCurrentUser };
