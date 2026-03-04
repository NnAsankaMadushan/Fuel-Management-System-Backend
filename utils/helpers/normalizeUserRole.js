const USER_ROLES = [
  "vehicle_owner",
  "station_owner",
  "station_operator",
  "admin",
];

const ROLE_ALIASES = {
  vehicleowner: "vehicle_owner",
  stationowner: "station_owner",
  stationer: "station_owner",
  stationoperator: "station_operator",
  operator: "station_operator",
};

const normalizeUserRole = (role) => {
  if (typeof role !== "string") {
    return role;
  }

  const sanitizedRole = role.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (!sanitizedRole) {
    return sanitizedRole;
  }

  if (USER_ROLES.includes(sanitizedRole)) {
    return sanitizedRole;
  }

  const collapsedRole = sanitizedRole.replace(/_/g, "");
  return ROLE_ALIASES[sanitizedRole] || ROLE_ALIASES[collapsedRole] || sanitizedRole;
};

const isSupportedUserRole = (role) => USER_ROLES.includes(normalizeUserRole(role));

export { USER_ROLES, normalizeUserRole, isSupportedUserRole };
