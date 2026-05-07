const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { User } = require("../models");
const {
  getQrCode,
  getStatus,
  initWhatsAppClient,
  logoutWhatsApp,
  sendWhatsAppText,
} = require("../services/waSender");

const router = express.Router();
const upload = multer();

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
  } catch (_) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

router.post("/whatsapp/init", requireAdmin, async (req, res) => {
  try {
    const status = await initWhatsAppClient();
    return res.status(200).json({ success: true, ...status });
  } catch (error) {
    console.error("WhatsApp init error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/whatsapp/status", requireAdmin, async (req, res) => {
  return res.status(200).json({ success: true, ...getStatus() });
});

router.get("/whatsapp/qr", requireAdmin, async (req, res) => {
  try {
    const qr = await getQrCode();
    return res.status(200).json({ success: true, ...qr });
  } catch (error) {
    console.error("WhatsApp QR error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/logout", requireAdmin, async (req, res) => {
  try {
    const result = await logoutWhatsApp();
    return res.status(200).json(result);
  } catch (error) {
    console.error("WhatsApp logout error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/send", requireAdmin, upload.none(), async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ error: "phone and message are required" });
    }

    const result = await sendWhatsAppText(phone, message);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("WhatsApp send error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
