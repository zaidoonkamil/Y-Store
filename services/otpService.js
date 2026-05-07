const { normalizeWhatsAppPhone } = require("./waSender");

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000);
const OTP_RESEND_MS = Number(process.env.OTP_RESEND_MS || 60 * 1000);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

const otpStore = new Map();

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getOtpKey(phone) {
  return normalizeWhatsAppPhone(phone);
}

function getOtpRecord(phone) {
  const key = getOtpKey(phone);
  const record = otpStore.get(key);

  if (!record) return null;

  if (record.expiresAt <= Date.now()) {
    otpStore.delete(key);
    return null;
  }

  return { key, record };
}

function createOtp(phone) {
  const key = getOtpKey(phone);
  const now = Date.now();
  const existing = otpStore.get(key);

  if (existing && existing.nextAllowedAt > now) {
    const waitSeconds = Math.ceil((existing.nextAllowedAt - now) / 1000);
    throw new Error(`Please wait ${waitSeconds} seconds before requesting a new OTP`);
  }

  const code = generateOtpCode();
  const record = {
    code,
    attempts: 0,
    expiresAt: now + OTP_TTL_MS,
    nextAllowedAt: now + OTP_RESEND_MS,
    verified: false,
  };

  otpStore.set(key, record);

  return {
    phone: key,
    code,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    retryAfterSeconds: Math.floor(OTP_RESEND_MS / 1000),
  };
}

function verifyOtp(phone, code) {
  const found = getOtpRecord(phone);

  if (!found) {
    throw new Error("OTP expired or not found");
  }

  const { key, record } = found;

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.delete(key);
    throw new Error("OTP attempts exceeded");
  }

  if (String(record.code) !== String(code).trim()) {
    record.attempts += 1;
    otpStore.set(key, record);
    throw new Error("OTP code is invalid");
  }

  record.verified = true;
  otpStore.delete(key);

  return {
    phone: key,
    verified: true,
  };
}

module.exports = {
  createOtp,
  verifyOtp,
};
