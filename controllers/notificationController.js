import mongoose from "mongoose";
import Notification from "../models/notification.js";

const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .populate("vehicle", "vehicleNumber")
      .sort({ createdAt: -1 })
      .limit(200);

    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getMyNotifications: ", error.message);
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    const notificationId = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      res.status(400).json({ message: "Invalid notification ID" });
      return;
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: req.user._id },
      { $set: { isRead: true } },
      { new: true }
    ).populate("vehicle", "vehicleNumber");

    if (!notification) {
      res.status(404).json({ message: "Notification not found" });
      return;
    }

    res.status(200).json({
      message: "Notification marked as read",
      notification,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to mark notification as read" });
    console.log("Error in markNotificationAsRead: ", error.message);
  }
};

const markAllMyNotificationsAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      message: "Notifications marked as read",
      modifiedCount: Number(result?.modifiedCount || 0),
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to mark notifications as read" });
    console.log("Error in markAllMyNotificationsAsRead: ", error.message);
  }
};

export { getMyNotifications, markNotificationAsRead, markAllMyNotificationsAsRead };
