import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../db/connectDB.js";
import VehicleRegistry from "../models/vehicleRegistry.js";
import vehicleRegistrySeed from "../data/vehicleRegistrySeed.js";
import {
  formatVehicleNumber,
  normalizeVehicleNumber,
} from "../utils/helpers/normalizeVehicleNumber.js";

dotenv.config();

const legacyFieldUnset = {
  Make: "",
  Model: "",
  Year: "",
  Registration_Date: "",
};

const toRegistryDocument = (vehicle) => ({
  ...vehicle,
  License_Plate: formatVehicleNumber(vehicle.License_Plate),
  normalizedLicensePlate: normalizeVehicleNumber(vehicle.License_Plate),
  Fuel_Type: String(vehicle.Fuel_Type).toLowerCase(),
  Vehicle_Type: String(vehicle.Vehicle_Type).toLowerCase(),
  Verified:
    vehicle.Verified === true ||
    String(vehicle.Verified).toLowerCase() === "true",
});

const seedVehicleRegistry = async () => {
  try {
    await connectDB();

    const registryDocuments = vehicleRegistrySeed.map(toRegistryDocument);

    await VehicleRegistry.bulkWrite(
      registryDocuments.map((vehicle) => ({
        updateOne: {
          filter: {
            normalizedLicensePlate: vehicle.normalizedLicensePlate,
          },
          update: { $set: vehicle, $unset: legacyFieldUnset },
          upsert: true,
        },
      }))
    );

    const totalCount = await VehicleRegistry.countDocuments();
    console.log(`Vehicle registry seeded successfully. Total records: ${totalCount}`);
  } catch (error) {
    console.error(`Error seeding vehicle registry: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

seedVehicleRegistry();
