import Notification from "../models/notification.js";

const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .populate("vehicle", "vehicleNumber verificationStatus isVerified")
      .sort({ createdAt: -1 });

    res.status(200).json(
      notifications.map((notification) => ({
        _id: notification._id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        status: notification.status,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
        vehicle: notification.vehicle
          ? {
              _id: notification.vehicle._id,
              vehicleNumber: notification.vehicle.vehicleNumber,
              verificationStatus:
                notification.vehicle.verificationStatus ||
                (notification.vehicle.isVerified ? "approved" : "pending"),
            }
          : null,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getMyNotifications: ", error.message);
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!notification) {
      res.status(404).json({ message: "Notification not found" });
      return;
    }

    notification.isRead = true;
    await notification.save();

    res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in markNotificationAsRead: ", error.message);
  }
};

export { getMyNotifications, markNotificationAsRead };
