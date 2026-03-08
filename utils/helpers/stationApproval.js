const STATION_VERIFICATION_STATUSES = ["pending", "approved", "rejected"];

const getStationVerificationStatus = (station = {}) => {
  if (!station || Object.keys(station).length === 0) {
    return "pending";
  }

  if (STATION_VERIFICATION_STATUSES.includes(station.verificationStatus)) {
    return station.verificationStatus;
  }

  if (typeof station.isVerified === "boolean") {
    return station.isVerified ? "approved" : "pending";
  }

  // Preserve legacy station records that existed before approval was introduced.
  return "approved";
};

const isStationApproved = (station = {}) =>
  getStationVerificationStatus(station) === "approved";

export {
  STATION_VERIFICATION_STATUSES,
  getStationVerificationStatus,
  isStationApproved,
};
