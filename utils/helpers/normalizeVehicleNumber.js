const normalizeVehicleNumber = (value = "") =>
  String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

const formatVehicleNumber = (value = "") =>
  String(value).toUpperCase().trim().replace(/\s+/g, " ");

export { normalizeVehicleNumber, formatVehicleNumber };
export default normalizeVehicleNumber;
