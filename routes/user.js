const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Op } = require("sequelize");
const { User, UserDevice, SellerFollow } = require("../models");
const OtpCode = require("../models/OtpCode");
const uploadImage = require("../middlewares/uploads");
const { sendWhatsAppText } = require("../services/waSender");
const { sendSubscriptionExpiryReminders } = require("../services/subscriptionReminders");
const { getSellerRatingsSummaryMap } = require("../services/sellerRatings");
const {
  IRAQI_GOVERNORATES,
  normalizeGovernorate,
  isValidIraqiGovernorate,
} = require("../constants/iraqiGovernorates");
const {
  WHOLESALE_LOCATIONS,
  normalizeWholesaleLocation,
  isValidWholesaleLocation,
} = require("../constants/wholesaleLocations");

const router = express.Router();
const upload = multer();
const saltRounds = 10;
const OTP_EXPIRES_MINUTES = 5;
const ADDITIONAL_VERIFICATION_TYPES = ["none", "six_months", "yearly"];
const DELIVERY_COMPANY_ROLE = "delivery_company";
const WHOLESALE_SELLER_ROLE = "wholesale_seller";

function normalizePhone(phone = "") {
  const value = String(phone).trim();
  if (value.startsWith("0")) {
    return "964" + value.slice(1);
  }
  return value;
}

function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "700d" }
  );
}

function getAdditionalVerificationData(user) {
  const endDate = user.additionalVerificationEndDate
    ? new Date(user.additionalVerificationEndDate)
    : null;
  const isActive = Boolean(
    user.additionalVerificationType &&
    user.additionalVerificationType !== "none" &&
    endDate &&
    endDate > new Date()
  );

  return {
    isAdditionalVerified: isActive,
    additionalVerificationType: isActive ? user.additionalVerificationType : "none",
    additionalVerificationStartDate: isActive ? user.additionalVerificationStartDate : null,
    additionalVerificationEndDate: isActive ? user.additionalVerificationEndDate : null,
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    image: user.image,
    name: user.name,
    phone: user.phone,
    location: user.location,
    role: user.role,
    isVerified: user.isVerified,
    storeActive: user.storeActive,
    ...getAdditionalVerificationData(user),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function getFollowersCountMap(sellerIds = []) {
  const uniqueSellerIds = [...new Set(sellerIds.map((id) => parseInt(id, 10)).filter(Boolean))];
  if (uniqueSellerIds.length === 0) {
    return {};
  }

  const follows = await SellerFollow.findAll({
    where: {
      sellerId: {
        [Op.in]: uniqueSellerIds,
      },
    },
    attributes: ["sellerId"],
  });

  return follows.reduce((acc, follow) => {
    acc[follow.sellerId] = (acc[follow.sellerId] || 0) + 1;
    return acc;
  }, {});
}

function serializeUserWithFollowersCount(user, followersCountMap = {}) {
  const userJson = serializeUser(user);
  return {
    ...userJson,
    followersCount: user.role === "agent" ? (followersCountMap[user.id] || 0) : 0,
  };
}

function serializeUserWithStats(user, followersCountMap = {}, ratingsSummaryMap = {}) {
  const userJson = serializeUserWithFollowersCount(user, followersCountMap);
  const ratingSummary = ratingsSummaryMap[user.id];

  return {
    ...userJson,
    ratingAverage: user.role === "agent" ? (ratingSummary?.average ?? null) : null,
    ratingsCount: user.role === "agent" ? (ratingSummary?.count || 0) : 0,
    isRated: user.role === "agent" ? Boolean(ratingSummary?.count) : false,
  };
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
      return res.status(403).json({ error: "Not allowed" });
    }

    req.user = admin;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function requireAdminOrAgent(req, res, next) {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ error: "Token is missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    if (!["admin", "agent"].includes(user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function buildAdditionalVerificationDates(type) {
  if (type === "none") {
    return {
      additionalVerificationType: "none",
      additionalVerificationStartDate: null,
      additionalVerificationEndDate: null,
      additionalVerificationReminderSentAt: null,
    };
  }

  const startDate = new Date();
  const endDate = new Date(startDate);

  if (type === "six_months") {
    endDate.setMonth(endDate.getMonth() + 6);
  } else if (type === "yearly") {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else {
    throw new Error("نوع التوثيق الإضافي غير صحيح");
  }

  return {
    additionalVerificationType: type,
    additionalVerificationStartDate: startDate,
    additionalVerificationEndDate: endDate,
    additionalVerificationReminderSentAt: null,
  };
}

async function createOtp({ phone, purpose }) {
  await OtpCode.update(
    { isUsed: true },
    {
      where: {
        phone,
        purpose,
        isUsed: false,
      },
    }
  );

  const code = generateOtp();
  const expiryDate = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

  const otp = await OtpCode.create({
    phone,
    code,
    purpose,
    expiryDate,
  });

  return { otp, code };
}

async function findValidOtp({ phone, code, purpose }) {
  return OtpCode.findOne({
    where: {
      phone,
      code,
      purpose,
      isUsed: false,
      expiryDate: { [Op.gt]: new Date() },
    },
    order: [["createdAt", "DESC"]],
  });
}

async function sendOtpMessage(phone, message) {
  try {
    await sendWhatsAppText(phone, message);
  } catch (error) {
    if (error?.message?.includes("WhatsApp client is not ready")) {
      throw new Error("واتساب غير مهيأ بعد. افتح QR وامسحه أولاً.");
    }
    throw error;
  }
}

async function sendPostVerificationMessage(phone, name) {
  const displayName = String(name || "").trim() || "عزيزنا";
  const message =
    `مبروك ${displayName}، تم توثيق حسابك بنجاح في Y Store.\n` +
    "نتمنى لك تجربة موفقة ، وجودك ويانا يضيف ثقة أكبر للمتجر.";

  await sendOtpMessage(phone, message);
}

router.post("/send-otp", upload.none(), async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const user = await User.findOne({ where: { phone: normalizedPhone } });

    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    const { code } = await createOtp({
      phone: normalizedPhone,
      purpose: "verify_account",
    });

    await sendOtpMessage(
      normalizedPhone,
      `رمز تفعيل الحساب الخاص بك هو: ${code}\nصالح لمدة ${OTP_EXPIRES_MINUTES} دقائق.`
    );

    return res.status(200).json({ message: "تم إرسال كود التفعيل عبر واتساب" });
  } catch (error) {
    console.error("❌ Error sending verification OTP:", error.message);
    return res.status(500).json({ error: error.message || "حدث خطأ أثناء إرسال الكود" });
  }
});

router.post("/resend-otp", upload.none(), async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const user = await User.findOne({ where: { phone: normalizedPhone } });

    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    if (user.isVerified) {
      return res.status(400).json({ error: "الحساب مفعل مسبقاً" });
    }

    const { code } = await createOtp({
      phone: normalizedPhone,
      purpose: "verify_account",
    });

    await sendOtpMessage(
      normalizedPhone,
      `رمز تفعيل الحساب الخاص بك هو: ${code}\nصالح لمدة ${OTP_EXPIRES_MINUTES} دقائق.`
    );

    return res.status(200).json({ message: "تمت إعادة إرسال كود التفعيل عبر واتساب" });
  } catch (error) {
    console.error("❌ Error resending verification OTP:", error.message);
    return res.status(500).json({ error: error.message || "حدث خطأ أثناء إعادة إرسال الكود" });
  }
});

router.post("/verify-otp", upload.none(), async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const code = String(req.body.code || "").trim();

    const otp = await findValidOtp({
      phone: normalizedPhone,
      code,
      purpose: "verify_account",
    });

    if (!otp) {
      return res.status(400).json({ error: "كود التحقق غير صالح أو منتهي" });
    }

    otp.isUsed = true;
    await otp.save();

    const user = await User.findOne({ where: { phone: normalizedPhone } });
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    user.isVerified = true;
    await user.save();

    await sendPostVerificationMessage(user.phone, user.name);

    const token = generateToken(user);

    return res.status(200).json({
      message: "تم تفعيل الحساب بنجاح",
      token,
      user: serializeUserWithStats(user),
    });
  } catch (error) {
    console.error("❌ Error verifying OTP:", error.message);
    return res.status(500).json({ error: "حدث خطأ داخلي في الخادم" });
  }
});

router.post("/forgot-password", upload.none(), async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const user = await User.findOne({ where: { phone: normalizedPhone } });

    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    const { code } = await createOtp({
      phone: normalizedPhone,
      purpose: "reset_password",
    });

    await sendOtpMessage(
      normalizedPhone,
      `رمز إعادة تعيين كلمة المرور هو: ${code}\nصالح لمدة ${OTP_EXPIRES_MINUTES} دقائق.`
    );

    return res.status(200).json({ message: "تم إرسال كود إعادة تعيين كلمة المرور عبر واتساب" });
  } catch (error) {
    console.error("❌ Error sending reset password OTP:", error.message);
    return res.status(500).json({ error: error.message || "حدث خطأ أثناء إرسال الكود" });
  }
});

router.post("/reset-password", upload.none(), async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "").trim();

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    }

    const otp = await findValidOtp({
      phone: normalizedPhone,
      code,
      purpose: "reset_password",
    });

    if (!otp) {
      return res.status(400).json({ error: "كود التحقق غير صالح أو منتهي" });
    }

    const user = await User.findOne({ where: { phone: normalizedPhone } });
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    otp.isUsed = true;
    await otp.save();

    user.password = await bcrypt.hash(newPassword, saltRounds);
    await user.save();

    return res.status(200).json({ message: "تم تغيير كلمة المرور بنجاح" });
  } catch (error) {
    console.error("❌ Error resetting password:", error.message);
    return res.status(500).json({ error: "حدث خطأ داخلي في الخادم" });
  }
});

router.post("/admin/agents", requireAdmin, uploadImage.array("images", 5), async (req, res) => {
  const { name, location, password } = req.body;
  let { phone } = req.body;

  try {
    phone = normalizePhone(phone);
    const normalizedLocation = normalizeGovernorate(location);

    if (!name || !phone || !location || !password) {
      return res.status(400).json({ error: "name, phone, location and password are required" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "يجب رفع صورة للتاجر" });
    }

    if (!isValidIraqiGovernorate(normalizedLocation)) {
      return res.status(400).json({
        error: "location must be one of the 19 Iraqi governorates",
        allowedLocations: IRAQI_GOVERNORATES,
      });
    }

    const existingPhone = await User.findOne({ where: { phone } });
    if (existingPhone) {
      return res.status(400).json({ error: "Phone already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const images = req.files.map((file) => file.filename);

    const agent = await User.create({
      name,
      phone,
      location: normalizedLocation,
      password: hashedPassword,
      role: "agent",
      isVerified: true,
      storeActive: false,
      image: images[0],
    });

    return res.status(201).json({
      message: "Agent account created successfully",
      user: serializeUserWithStats(agent),
    });
  } catch (error) {
    console.error("❌ Error creating admin agent:", error.message);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

router.post("/users", uploadImage.array("images", 5), async (req, res) => {
  const { name, location, password, role = "user" } = req.body;
  let { phone } = req.body;

  try {
    phone = normalizePhone(phone);
    const normalizedLocation = normalizeGovernorate(location);

    if (role === DELIVERY_COMPANY_ROLE) {
      return res.status(403).json({ error: "Delivery company accounts can only be created by admin" });
    }

    if (role === WHOLESALE_SELLER_ROLE) {
      return res.status(403).json({ error: "Wholesale seller accounts can only be created by admin" });
    }

    if (role === "agent" && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ error: "يجب رفع صورة للـ agent" });
    }

    if (!name || !phone || !location || !password) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة" });
    }

    const existingPhone = await User.findOne({ where: { phone } });
    if (existingPhone) {
      return res.status(400).json({ error: "تم استخدام رقم الهاتف من مستخدم اخر" });
    }

    if (!isValidIraqiGovernorate(normalizedLocation)) {
      return res.status(400).json({
        error: "الموقع يجب أن يكون إحدى المحافظات العراقية الـ 19 فقط",
        allowedLocations: IRAQI_GOVERNORATES,
      });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const images = Array.isArray(req.files) ? req.files.map((file) => file.filename) : [];
    const isVerified = role === "admin";

    const user = await User.create({
      name,
      phone,
      location: normalizedLocation,
      password: hashedPassword,
      role,
      isVerified,
      image: images.length > 0 ? images[0] : null,
    });

    if (!isVerified) {
      const { code } = await createOtp({
        phone,
        purpose: "verify_account",
      });

      await sendOtpMessage(
        phone,
        `رمز تفعيل الحساب الخاص بك هو: ${code}\nصالح لمدة ${OTP_EXPIRES_MINUTES} دقائق.`
      );
    }

    return res.status(201).json({
      ...serializeUserWithStats(user),
      message: isVerified
        ? "تم إنشاء الحساب بنجاح"
        : "تم إنشاء الحساب. يرجى تفعيل الحساب عبر كود واتساب",
    });
  } catch (error) {
    console.error("❌ Error creating user:", error.message);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

router.post("/login", upload.none(), async (req, res) => {
  const { phone, password } = req.body;

  try {
    if (!phone) {
      return res.status(400).json({ error: "يرجى إدخال رقم الهاتف" });
    }

    const normalizedPhone = normalizePhone(phone);
    const user = await User.findOne({ where: { phone: normalizedPhone } });

    if (!user) {
      return res.status(400).json({ error: "يرجى إدخال رقم الهاتف بشكل صحيح" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: "كلمة المرور غير صحيحة" });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        error: "الحساب غير مفعل. يرجى تفعيل الحساب عبر كود واتساب أولاً",
        code: "ACCOUNT_NOT_VERIFIED",
        isVerified: false,
        phone: user.phone,
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      message: "Login successful",
      user: serializeUserWithStats(user),
      token,
    });
  } catch (error) {
    console.error("❌ Error during login:", error.message);
    return res.status(500).json({ error: "خطأ داخلي في الخادم" });
  }
});

router.delete("/users/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findByPk(id, {
      include: { model: UserDevice, as: "devices" },
    });

    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    await user.destroy();
    return res.status(200).json({ message: "تم حذف المستخدم وأجهزته بنجاح" });
  } catch (error) {
    console.error("❌ Error deleting user:", error.message);
    return res.status(500).json({ error: "حدث خطأ أثناء عملية الحذف" });
  }
});

router.patch("/admin/users/:id/additional-verification", requireAdmin, upload.none(), async (req, res) => {
  try {
    const { id } = req.params;
    const type = String(req.body.type || "").trim();

    if (!ADDITIONAL_VERIFICATION_TYPES.includes(type)) {
      return res.status(400).json({
        error: "type must be one of: none, six_months, yearly",
      });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    if (user.role !== "agent") {
      return res.status(400).json({ error: "التوثيق الإضافي متاح للتجار فقط" });
    }

    await user.update(buildAdditionalVerificationDates(type));

    return res.status(200).json({
      message:
        type === "none"
          ? "تمت إزالة التوثيق الإضافي من التاجر"
          : "تم تحديث التوثيق الإضافي للتاجر بنجاح",
      user: serializeUser(user),
    });
  } catch (error) {
    console.error("❌ Error updating additional verification:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/admin/delivery-companies", requireAdmin, upload.none(), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "").trim();
    const location = normalizeGovernorate(req.body.location);

    if (!name || !phone || !password || !location) {
      return res.status(400).json({ error: "name, phone, password and location are required" });
    }

    if (!isValidIraqiGovernorate(location)) {
      return res.status(400).json({
        error: "location must be one of the 19 Iraqi governorates",
        allowedLocations: IRAQI_GOVERNORATES,
      });
    }

    const existingPhone = await User.findOne({ where: { phone } });
    if (existingPhone) {
      return res.status(400).json({ error: "Phone already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const company = await User.create({
      name,
      phone,
      location,
      password: hashedPassword,
      role: DELIVERY_COMPANY_ROLE,
      isVerified: true,
      storeActive: false,
    });

    return res.status(201).json({
      message: "Delivery company account created successfully",
      user: serializeUser(company),
    });
  } catch (error) {
    console.error("❌ Error creating delivery company:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/admin/wholesale-sellers", requireAdmin, upload.none(), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "").trim();
    const location = normalizeWholesaleLocation(req.body.location);

    if (!name || !phone || !password || !location) {
      return res.status(400).json({ error: "name, phone, password and location are required" });
    }

    if (!isValidWholesaleLocation(location)) {
      return res.status(400).json({
        error: "location must be one of: بغداد, أربيل, تركيا",
        allowedLocations: WHOLESALE_LOCATIONS,
      });
    }

    const existingPhone = await User.findOne({ where: { phone } });
    if (existingPhone) {
      return res.status(400).json({ error: "Phone already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const wholesaleSeller = await User.create({
      name,
      phone,
      location,
      password: hashedPassword,
      role: WHOLESALE_SELLER_ROLE,
      isVerified: true,
      storeActive: true,
    });

    return res.status(201).json({
      message: "Wholesale seller account created successfully",
      user: serializeUser(wholesaleSeller),
    });
  } catch (error) {
    console.error("❌ Error creating wholesale seller:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/delivery-companies", async (req, res) => {
  try {
    const location = normalizeGovernorate(req.query.location);
    const where = { role: DELIVERY_COMPANY_ROLE };

    if (location) {
      if (!isValidIraqiGovernorate(location)) {
        return res.status(400).json({
          error: "location must be one of the 19 Iraqi governorates",
          allowedLocations: IRAQI_GOVERNORATES,
        });
      }
      where.location = location;
    }

    const companies = await User.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      count: companies.length,
      companies: companies.map((company) => serializeUser(company)),
    });
  } catch (error) {
    console.error("❌ Error fetching delivery companies:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/wholesale-sellers", requireAdminOrAgent, async (req, res) => {
  try {
    const location = normalizeWholesaleLocation(req.query.location);
    const where = { role: WHOLESALE_SELLER_ROLE };

    if (location) {
      if (!isValidWholesaleLocation(location)) {
        return res.status(400).json({
          error: "location must be one of: بغداد, أربيل, تركيا",
          allowedLocations: WHOLESALE_LOCATIONS,
        });
      }
      where.location = location;
    }

    const sellers = await User.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      count: sellers.length,
      sellers: sellers.map((seller) => serializeUser(seller)),
    });
  } catch (error) {
    console.error("❌ Error fetching wholesale sellers:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/wholesale-sellers/locations", requireAdminOrAgent, async (_req, res) => {
  return res.status(200).json({ locations: WHOLESALE_LOCATIONS });
});

router.post("/admin/subscriptions/send-expiry-reminders", requireAdmin, async (req, res) => {
  try {
    const result = await sendSubscriptionExpiryReminders();
    return res.status(200).json({
      message: "تم فحص وإرسال تنبيهات الاشتراكات القريبة من الانتهاء",
      ...result,
    });
  } catch (error) {
    console.error("❌ Error sending subscription expiry reminders:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/verify-token", (req, res) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.json({ valid: false, message: "Token is missing" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.json({ valid: false, message: "Invalid token" });
    }
    return res.json({ valid: true, data: decoded });
  });
});

router.get("/usersOnly", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const { count, rows: users } = await User.findAndCountAll({
      where: {
        role: "user",
      },
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    const totalPages = Math.ceil(count / limit);
    const userIds = users.map((user) => user.id);
    const followersCountMap = await getFollowersCountMap(userIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(userIds);

    return res.status(200).json({
      users: users.map((user) => serializeUserWithStats(user, followersCountMap, ratingsSummaryMap)),
      pagination: {
        totalUsers: count,
        currentPage: page,
        totalPages,
        limit,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching users:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/agentsOnly", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const { count, rows: users } = await User.findAndCountAll({
      where: {
        role: "agent",
      },
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    const totalPages = Math.ceil(count / limit);
    const userIds = users.map((user) => user.id);
    const followersCountMap = await getFollowersCountMap(userIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(userIds);

    return res.status(200).json({
      users: users.map((user) => serializeUserWithStats(user, followersCountMap, ratingsSummaryMap)),
      pagination: {
        totalUsers: count,
        currentPage: page,
        totalPages,
        limit,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching agents:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/search/sellers", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    if (query.length < 2) {
      return res.status(400).json({ error: "يجب أن يكون البحث من حرفين على الأقل" });
    }

    const sellers = await User.findAll({
      where: {
        role: "agent",
        name: {
          [Op.like]: `%${query}%`,
        },
      },
      limit,
      order: [["createdAt", "DESC"]],
    });

    const sellerIds = sellers.map((seller) => seller.id);
    const followersCountMap = await getFollowersCountMap(sellerIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

    return res.status(200).json({
      query,
      count: sellers.length,
      sellers: sellers.map((seller) =>
        serializeUserWithStats(seller, followersCountMap, ratingsSummaryMap)
      ),
    });
  } catch (error) {
    console.error("❌ Error searching sellers:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/user/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }
    const followersCountMap = await getFollowersCountMap([user.id]);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap([user.id]);
    return res.status(200).json(serializeUserWithStats(user, followersCountMap, ratingsSummaryMap));
  } catch (error) {
    console.error("❌ Error fetching user:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/profile", async (req, res) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: "Token is missing" });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: "Invalid token" });
    }

    try {
      const user = await User.findByPk(decoded.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const followersCountMap = await getFollowersCountMap([user.id]);
      const ratingsSummaryMap = await getSellerRatingsSummaryMap([user.id]);
      return res.status(200).json(serializeUserWithStats(user, followersCountMap, ratingsSummaryMap));
    } catch (error) {
      console.error("❌ Error fetching user profile:", error.message);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
});

module.exports = router;
