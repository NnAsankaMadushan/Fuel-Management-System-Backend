import VehicleRegistry from "../models/vehicleRegistry.js";
import {
    formatVehicleNumber,
    normalizeVehicleNumber,
} from "../utils/helpers/normalizeVehicleNumber.js";

// add a new vehicle to the registry from a set of vehicles
const addVehicleRegistry = async (req, res) => {
    try {
        if (!Array.isArray(req.body)) {
            return res.status(400).json({ message: "Vehicle registry payload must be an array" });
        }

        const legacyFieldUnset = {
            Make: "",
            Model: "",
            Year: "",
            Registration_Date: "",
        };

        // Required fields for validation
        const requiredFields = [
            "License_Plate",
            "Engine_Number",
            "Chassis_Number",
            "Fuel_Type",
            "Vehicle_Type",
            "Verified"
        ];

        // Filter out invalid vehicle records (those missing required fields)
        const validVehicles = req.body
            .filter(vehicle =>
                requiredFields.every(field => vehicle.hasOwnProperty(field))
            )
            .map(vehicle => ({
                ...vehicle,
                License_Plate: formatVehicleNumber(vehicle.License_Plate),
                normalizedLicensePlate: normalizeVehicleNumber(vehicle.License_Plate),
                Fuel_Type: String(vehicle.Fuel_Type).toLowerCase(),
                Vehicle_Type: String(vehicle.Vehicle_Type).toLowerCase(),
                Verified:
                    vehicle.Verified === true ||
                    String(vehicle.Verified).toLowerCase() === "true",
            }))
            .filter(vehicle => vehicle.normalizedLicensePlate);

        if (validVehicles.length === 0) {
            return res.status(400).json({ message: "No valid vehicle data provided" });
        }

        await VehicleRegistry.bulkWrite(
            validVehicles.map(vehicle => ({
                updateOne: {
                    filter: { normalizedLicensePlate: vehicle.normalizedLicensePlate },
                    update: { $set: vehicle, $unset: legacyFieldUnset },
                    upsert: true,
                },
            }))
        );

        const normalizedLicensePlates = validVehicles.map(
            vehicle => vehicle.normalizedLicensePlate
        );
        const vehicleRegistry = await VehicleRegistry.find({
            normalizedLicensePlate: { $in: normalizedLicensePlates },
        });

        if (vehicleRegistry.length > 0) {
            res.status(201).json(vehicleRegistry);
        } else {
            res.status(400).json({ message: "No vehicles were registered" });
        }
        
    } catch (error) {
        res.status(500).json({ message: error.message });
        console.log("Error in addVehicleRegistry: ", error.message);  
    }
};

export { addVehicleRegistry };
