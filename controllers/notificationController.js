const getMyNotifications = async (req, res) => {
  try {
    res.status(200).json([]);
  } catch (error) {
    res.status(500).json({ message: error.message });
    console.log("Error in getMyNotifications: ", error.message);
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    res.status(200).json({
      message: "Notifications are managed locally on the client",
      notification: {
        _id: String(req.params.id || "").trim(),
        isRead: true,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to mark notification as read" });
    console.log("Error in markNotificationAsRead: ", error.message);
  }
};

const markAllMyNotificationsAsRead = async (req, res) => {
  try {
    res.status(200).json({
      message: "Notifications are managed locally on the client",
      modifiedCount: 0,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to mark notifications as read" });
    console.log("Error in markAllMyNotificationsAsRead: ", error.message);
  }
};

export { getMyNotifications, markNotificationAsRead, markAllMyNotificationsAsRead };
