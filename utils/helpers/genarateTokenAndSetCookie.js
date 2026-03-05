import jwt from "jsonwebtoken";

export const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "15d",
  });

const AUTH_COOKIE_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;

const getAuthCookieOptions = ({ includeMaxAge = false } = {}) => {
  const isProduction = process.env.NODE_ENV === "production";
  const options = {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
    path: "/",
  };

  if (includeMaxAge) {
    options.maxAge = AUTH_COOKIE_MAX_AGE_MS;
  }

  return options;
};

export const setAuthCookie = (res, token) => {
  res.cookie("jwt", token, getAuthCookieOptions({ includeMaxAge: true }));
};

export const clearAuthCookie = (res) => {
  res.clearCookie("jwt", getAuthCookieOptions());
};

const generateTokenAndSetCookie = (userId, res) => {
  const token = generateToken(userId);
  setAuthCookie(res, token);
  return token;
};

export default generateTokenAndSetCookie;
