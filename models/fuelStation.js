import mongoose from "mongoose";

const fuelStationSchema = new mongoose.Schema(
  {
    fuelStationOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    stationName: {
      type: String,
      required: true,
    },
    location: {
      type: String,
      required: true,
    },
    registeredVehicles: [
      {
        vehicle: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Vehicle",
        },
        date: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    stationOperators: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    station_regNumber: {
      type: String,
      required: true,
      unique: true,
    },
    availablePetrol: {
      type: Number,
      default: 0,
      min: 0,
    },
    availableDiesel: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

const FuelStation = mongoose.model("FuelStation", fuelStationSchema);

export default FuelStation;
