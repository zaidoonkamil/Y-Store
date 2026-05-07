const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Op } = require("sequelize");
const { User } = require("../models");
const {
  getQrCode,
  getStatus,
  initWhatsAppClient,
  logoutWhatsApp,
  normalizeWhatsAppPhone,
  sendWhatsAppText,
} = require("../services/waSender");
const { createOtp, verifyOtp } = require("../services/otpService");

const router = express.Router();
const upload = multer();

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

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
      return res.status(403).json({ error: "Only admin can use WhatsApp service" });
    }

    req.user = admin;
    next();
  } catch (_) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "700d" }
  );
}

router.post("/whatsapp/otp/request", upload.none(), async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    const otp = createOtp(phone);
    const message = `رمز التحقق الخاص بك هو: ${otp.code}\nصالح لمدة ${Math.floor(otp.expiresInSeconds / 60)} دقائق.`;

    await sendWhatsAppText(otp.phone, message);

    return res.status(200).json({
      success: true,
      phone: otp.phone,
      expiresInSeconds: otp.expiresInSeconds,
      retryAfterSeconds: otp.retryAfterSeconds,
    });
  } catch (error) {
    console.error("WhatsApp OTP request error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/otp/verify", upload.none(), async (req, res) => {
  try {
    const { phone, code } = req.body;

    if (!phone || !code) {
      return res.status(400).json({ error: "phone and code are required" });
    }

    const result = verifyOtp(phone, code);
    const user = await User.findOne({ where: { phone: result.phone } });

    if (!user) {
      return res.status(200).json({
        success: true,
        verified: true,
        phone: result.phone,
        userExists: false,
      });
    }

    user.isVerified = true;
    await user.save();

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      verified: true,
      phone: result.phone,
      userExists: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        location: user.location,
        image: user.image,
        isVerified: user.isVerified,
        storeActive: user.storeActive,
      },
    });
  } catch (error) {
    console.error("WhatsApp OTP verify error:", error.message);
    return res.status(400).json({ error: error.message });
  }
});

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
    const { user_id, phone, message } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    let targetPhone = phone;
    let user = null;

    if (!targetPhone && user_id) {
      user = await User.findByPk(user_id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      targetPhone = user.phone;
    }

    if (!targetPhone) {
      return res.status(400).json({ error: "phone or user_id is required" });
    }

    const result = await sendWhatsAppText(targetPhone, message);

    return res.status(200).json({
      success: true,
      phone: result.to,
      user_id: user ? user.id : null,
      messageId: result.messageId,
      timestamp: result.timestamp,
      status: result.status,
    });
  } catch (error) {
    console.error("WhatsApp send error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/whatsapp/send-bulk", requireAdmin, upload.none(), async (req, res) => {
  try {
    const { message } = req.body;
    const phones = parseList(req.body.phones);
    const userIds = parseList(req.body.user_ids);
    const role = req.body.role ? String(req.body.role).trim() : "";

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    if (!phones.length && !userIds.length && !role) {
      return res.status(400).json({ error: "phones, user_ids or role is required" });
    }

    const targets = new Map();

    for (const rawPhone of phones) {
      const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
      targets.set(normalizedPhone, { phone: normalizedPhone, user_id: null });
    }

    const where = {};
    if (userIds.length) {
      where.id = { [Op.in]: userIds };
    }
    if (role) {
      where.role = role;
    }

    if (Object.keys(where).length) {
      const users = await User.findAll({ where });

      for (const user of users) {
        if (!user.phone) continue;
        const normalizedPhone = normalizeWhatsAppPhone(user.phone);
        targets.set(normalizedPhone, { phone: normalizedPhone, user_id: user.id });
      }
    }

    const results = [];

    for (const target of targets.values()) {
      try {
        const sendResult = await sendWhatsAppText(target.phone, message);
        results.push({
          success: true,
          phone: target.phone,
          user_id: target.user_id,
          messageId: sendResult.messageId,
          timestamp: sendResult.timestamp,
        });
      } catch (error) {
        results.push({
          success: false,
          phone: target.phone,
          user_id: target.user_id,
          error: error.message,
        });
      }
    }

    const sent = results.filter((item) => item.success).length;

    return res.status(200).json({
      success: true,
      total: results.length,
      sent,
      failed: results.length - sent,
      results,
    });
  } catch (error) {
    console.error("WhatsApp bulk send error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
