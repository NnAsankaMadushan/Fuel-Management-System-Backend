import jwt from "jsonwebtoken";

export const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "15d",
  });

export const setAuthCookie = (res, token) => {
  const options = {
    httpOnly: true,
    maxAge: 15 * 24 * 60 * 60 * 1000,
    sameSite: "strict",
  };

  res.cookie("jwt", token, options);
};

const generateTokenAndSetCookie = (userId, res) => {
  const token = generateToken(userId);
  setAuthCookie(res, token);
  return token;
};

export default generateTokenAndSetCookie;
