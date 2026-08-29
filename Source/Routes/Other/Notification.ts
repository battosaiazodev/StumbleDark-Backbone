import { Router } from "express";
import j from "joi";
import { ValidateHeaders } from "../../Modules/Middleware";
import { IS_MAINTENANCE } from "../../Backbone/Config";

const App = Router();

const NotificationSchema = j
  .object({
    backbone_app_id: j.string().required().valid("8561191D-03B7-423E-B779-D2F6E77A3A45"),
    "x-unity-version": j.string().required(),
    access_token: j.string().required(),
  })
  .unknown(true);

App.post("/notificationGetActive", ValidateHeaders(NotificationSchema), async (_req, res) => {
  const notifications: any[] = [];

  // إشعار الصيانة إذا كان النظام في وضع الصيانة
  if (IS_MAINTENANCE) {
    notifications.push({
      id: "maintenance_notice",
      type: "warning",
      title: "Maintenance",
      message: "The servers are currently under maintenance. Please check back later.",
      timestamp: new Date().toISOString(),
    });
  }

  return res.status(200).json({ notifications });
});

export default {
  App,
  DefaultAPI: "/api/v1",
};
