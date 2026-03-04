import jwt from "jsonwebtoken";
import User from "../models/user.js";
import { normalizeUserRole } from "../utils/helpers/normalizeUserRole.js";

const getRequestToken = (req) => {
  const authorizationHeader = req.headers.authorization || "";

  if (authorizationHeader.startsWith("Bearer ")) {
    return authorizationHeader.slice(7).trim();
  }

  return req.cookies.jwt;
};

const protectRoute = async (req, res, next) => {
  const token = getRequestToken(req);
  if (!token) {
    return res.status(401).json({ message: "You need to login first" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId;

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.role = normalizeUserRole(user.role);
    req.user = user;

    next();
  } catch (error) {
    res.status(401).json({ message: "You need to login first" });
    console.log("Error in protectRoute: ", error.message);
  }
}

const authorizeRole = async (req, res, next) => {
  try {
    const user = req.user;
    if(!user || !user.role ){
      return res.status(401).json({ message: "You are not authorized to access this route" });
    }

    req.role = normalizeUserRole(user.role);

    next();
    
  } catch (error) {
    res.status(401).json({ message: "You are not authorized to access this route" });
    console.log("Error in authorizeRole: ", error.message
    );
  }
}

// admin role is required to access this route
const authorizeAdmin = async (req, res, next) => {
  try {
    const user = req.user;
    const normalizedRole = normalizeUserRole(user?.role);

    if(!user || normalizedRole !== "admin"){
      return res.status(401).json({ message: "You are not authorized to access this route" });
    }

    req.role = normalizedRole;

    next();
    
  } catch (error) {
    res.status(401).json({ message: "You are not authorized to access this route" });
    console.log("Error in authorizeAdmin: ", error.message
    );
  }
}

export { protectRoute, authorizeRole, authorizeAdmin };
