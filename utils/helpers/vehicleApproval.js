const VEHICLE_VERIFICATION_STATUSES = ["pending", "approved", "rejected"];

const getVehicleVerificationStatus = (vehicle = {}) => {
  if (VEHICLE_VERIFICATION_STATUSES.includes(vehicle.verificationStatus)) {
    return vehicle.verificationStatus;
  }

  return vehicle.isVerified ? "approved" : "pending";
};

const isVehicleApproved = (vehicle = {}) =>
  getVehicleVerificationStatus(vehicle) === "approved";

export {
  VEHICLE_VERIFICATION_STATUSES,
  getVehicleVerificationStatus,
  isVehicleApproved,
};
