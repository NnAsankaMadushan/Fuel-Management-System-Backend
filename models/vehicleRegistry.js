import mongoose from "mongoose";

const vehicleRegistrySchema = new mongoose.Schema(
  {
    License_Plate: {
      type: String,
      required: true,
    },
    normalizedLicensePlate: {
      type: String,
      required: true,
      unique: true,
    },
    Engine_Number: {
      type: String,
      required: true,
    },
    Chassis_Number: {
      type: String,
      required: true,
    },
    Fuel_Type: {
      type: String,
      enum: ["petrol", "diesel"],
      required: true,
    },
    Vehicle_Type: {
      type: String,
      enum: ["car", "bike", "truck", "bus"],
      required: true,
    },
    Verified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const VehicleRegistry = mongoose.model("VehicleRegistry", vehicleRegistrySchema);

export default VehicleRegistry;
