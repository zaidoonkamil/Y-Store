const express = require("express");
const jwt = require("jsonwebtoken");
const uploadImage = require("../middlewares/uploads");
const { User, AgentSubscriptionRequest } = require("../models");
const {
  SUBSCRIPTION_PACKAGES,
  isValidSubscriptionPackage,
} = require("../constants/subscriptionPackages");
const {
  activateSubscription,
  getActiveSubscriptionForAgent,
} = require("../services/subscriptions");
const {
  sendNotificationToRole,
  sendNotificationToUser,
} = require("../services/notifications");

const router = express.Router();

async function requireAdmin(req, res, next) {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ error: "Token is missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await User.findByPk(decoded.id);

    if (!admin) {
      return res.status(401).json({ error: "User not found" });
    }

    if (admin.role !== "admin") {
      return res.status(403).json({ error: "Not allowed" });
    }

    req.user = admin;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

router.get("/subscription-packages", async (req, res) => {
  return res.status(200).json({
    packages: Object.values(SUBSCRIPTION_PACKAGES),
  });
});

router.post("/subscription-requests", uploadImage.single("transferReceiptImage"), async (req, res) => {
  try {
    const { agentId, requestedPackage } = req.body;

    if (!agentId || !requestedPackage) {
      return res.status(400).json({ error: "agentId and requestedPackage are required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "يجب رفع صورة وصل التحويل" });
    }

    if (!isValidSubscriptionPackage(requestedPackage)) {
      return res.status(400).json({
        error: "الباقة غير صحيحة",
        allowedPackages: Object.keys(SUBSCRIPTION_PACKAGES),
      });
    }

    const agent = await User.findByPk(agentId);
    if (!agent || agent.role !== "agent") {
      return res.status(404).json({ error: "التاجر غير موجود" });
    }

    const pendingRequest = await AgentSubscriptionRequest.findOne({
      where: {
        agentId,
        status: "pending",
      },
      order: [["createdAt", "DESC"]],
    });

    if (pendingRequest) {
      return res.status(400).json({ error: "يوجد طلب اشتراك قيد المراجعة بالفعل" });
    }

    const request = await AgentSubscriptionRequest.create({
      agentId,
      requestedPackage,
      transferReceiptImage: req.file.filename,
      status: "pending",
    });

    agent.storeActive = false;
    await agent.save();

    await sendNotificationToRole(
      "admin",
      `تم إرسال طلب اشتراك جديد من التاجر ${agent.name}`,
      "طلب اشتراك جديد"
    );

    return res.status(201).json({
      message: "تم إرسال طلب الاشتراك بنجاح وهو الآن بانتظار مراجعة الأدمن",
      request,
    });
  } catch (error) {
    console.error("❌ Error creating subscription request:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/subscription-requests/admin", requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};

    if (status) {
      where.status = status;
    }

    const requests = await AgentSubscriptionRequest.findAll({
      where,
      include: [
        {
          model: User,
          as: "agent",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "storeActive"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({ requests });
  } catch (error) {
    console.error("❌ Error fetching admin subscription requests:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/subscription-requests/:id/review", requireAdmin, async (req, res) => {
  try {
    const { status, approvedPackage, adminNote } = req.body;
    const request = await AgentSubscriptionRequest.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: "agent",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "storeActive"],
        },
      ],
    });

    if (!request) {
      return res.status(404).json({ error: "طلب الاشتراك غير موجود" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ error: "تمت مراجعة هذا الطلب مسبقاً" });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "حالة المراجعة غير صحيحة" });
    }

    if (status === "approved" && !isValidSubscriptionPackage(approvedPackage)) {
      return res.status(400).json({ error: "يجب تحديد باقة صحيحة عند الموافقة" });
    }

    request.status = status;
    request.approvedPackage = status === "approved" ? approvedPackage : null;
    request.adminNote = adminNote || null;
    request.reviewedBy = req.user.id;
    request.reviewedAt = new Date();
    await request.save();

    let activeSubscription = null;

    if (status === "approved") {
      activeSubscription = await activateSubscription({
        agentId: request.agentId,
        packageType: approvedPackage,
        approvedBy: req.user.id,
        requestId: request.id,
      });

      await sendNotificationToUser(
        request.agentId,
        "تمت الموافقة على اشتراكك وتفعيل المتجر بنجاح",
        "تمت الموافقة على الاشتراك"
      );
    } else {
      await User.update({ storeActive: false }, { where: { id: request.agentId } });

      await sendNotificationToUser(
        request.agentId,
        adminNote
          ? `تم رفض طلب الاشتراك. السبب: ${adminNote}`
          : "تم رفض طلب الاشتراك الخاص بك",
        "تم رفض الاشتراك"
      );
    }

    return res.status(200).json({
      message: status === "approved" ? "تمت الموافقة على الطلب وتفعيل المتجر" : "تم رفض طلب الاشتراك",
      request,
      activeSubscription,
    });
  } catch (error) {
    console.error("❌ Error reviewing subscription request:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/subscription-requests/agent/:agentId", async (req, res) => {
  try {
    const requests = await AgentSubscriptionRequest.findAll({
      where: {
        agentId: req.params.agentId,
      },
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({ requests });
  } catch (error) {
    console.error("❌ Error fetching agent subscription requests:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/subscription-status/:agentId", async (req, res) => {
  try {
    const agent = await User.findByPk(req.params.agentId, {
      attributes: ["id", "name", "phone", "role", "isVerified", "storeActive"],
    });

    if (!agent || agent.role !== "agent") {
      return res.status(404).json({ error: "التاجر غير موجود" });
    }

    const activeSubscription = await getActiveSubscriptionForAgent(agent.id);
    const latestRequest = await AgentSubscriptionRequest.findOne({
      where: {
        agentId: agent.id,
      },
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      agent,
      activeSubscription,
      latestRequest,
      availablePackages: Object.values(SUBSCRIPTION_PACKAGES),
    });
  } catch (error) {
    console.error("❌ Error fetching subscription status:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
