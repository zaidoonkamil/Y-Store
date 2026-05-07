const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH
  ? path.resolve(process.env.WHATSAPP_SESSION_PATH)
  : path.join(__dirname, "..", ".wwebjs_auth");
const CLIENT_ID = process.env.WHATSAPP_CLIENT_ID || "y-store";
const AUTO_INIT = process.env.WHATSAPP_AUTO_INIT !== "false";
const RECONNECT_DELAY_MS = Number(process.env.WHATSAPP_RECONNECT_DELAY_MS || 15000);
const MAX_RECONNECT_DELAY_MS = Number(process.env.WHATSAPP_MAX_RECONNECT_DELAY_MS || 120000);
const READY_WAIT_TIMEOUT_MS = Number(process.env.WHATSAPP_READY_WAIT_TIMEOUT_MS || 20000);

let client = null;
let initializingPromise = null;
let latestQrText = null;
let latestQrImage = null;
let latestError = null;
let connectionStatus = "idle";
let authenticated = false;
let connectedNumber = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let manualLogout = false;

function ensureSessionPath() {
  fs.mkdirSync(SESSION_PATH, { recursive: true });
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function getReconnectDelay() {
  const delay = RECONNECT_DELAY_MS * Math.max(1, reconnectAttempts);
  return Math.min(delay, MAX_RECONNECT_DELAY_MS);
}

function scheduleReconnect(reason = "unknown") {
  if (!AUTO_INIT || manualLogout || initializingPromise || client) {
    return;
  }

  clearReconnectTimer();
  reconnectAttempts += 1;
  const delay = getReconnectDelay();
  connectionStatus = "reconnecting";
  latestError = `Reconnecting after disconnect: ${reason}`;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await initWhatsAppClient();
    } catch (error) {
      latestError = error.message || String(error);
      scheduleReconnect(latestError);
    }
  }, delay);
}

function normalizeWhatsAppPhone(phone = "") {
  let value = String(phone).trim();

  if (!value) {
    throw new Error("Phone number is required");
  }

  value = value.replace(/[^\d+]/g, "");

  if (value.startsWith("+")) value = value.slice(1);
  if (value.startsWith("00")) value = value.slice(2);
  if (value.startsWith("0")) value = `964${value.slice(1)}`;

  if (!/^\d{8,15}$/.test(value)) {
    throw new Error("Phone number format is invalid");
  }

  return value;
}

function getStatus() {
  return {
    status: connectionStatus,
    authenticated,
    hasQr: Boolean(latestQrImage),
    connectedNumber,
    lastError: latestError,
  };
}

function waitForClientReady(timeoutMs = READY_WAIT_TIMEOUT_MS) {
  if (client && connectionStatus === "ready") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const timer = setInterval(() => {
      if (client && connectionStatus === "ready") {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error("WhatsApp client is not ready yet. Wait a few seconds and try again."));
      }
    }, 500);
  });
}

async function buildQrImage(qrText) {
  latestQrText = qrText;
  latestQrImage = await qrcode.toDataURL(qrText);
}

function bindClientEvents(instance) {
  instance.on("qr", async (qrText) => {
    clearReconnectTimer();
    connectionStatus = "qr_ready";
    latestError = null;
    connectedNumber = null;
    authenticated = false;

    try {
      await buildQrImage(qrText);
    } catch (error) {
      latestError = `QR generation failed: ${error.message}`;
    }
  });

  instance.on("authenticated", () => {
    clearReconnectTimer();
    reconnectAttempts = 0;
    authenticated = true;
    latestError = null;
    connectionStatus = "authenticated";
  });

  instance.on("ready", () => {
    clearReconnectTimer();
    reconnectAttempts = 0;
    connectionStatus = "ready";
    latestQrText = null;
    latestQrImage = null;
    latestError = null;

    try {
      const wid = instance.info?.wid?._serialized || "";
      connectedNumber = wid.replace("@c.us", "") || null;
    } catch (_) {
      connectedNumber = null;
    }
  });

  instance.on("auth_failure", (message) => {
    clearReconnectTimer();
    authenticated = false;
    connectionStatus = "auth_failure";
    latestError = message || "Authentication failed";
  });

  instance.on("disconnected", (reason) => {
    authenticated = false;
    connectionStatus = "disconnected";
    latestError = reason || "Client disconnected";
    latestQrText = null;
    latestQrImage = null;
    connectedNumber = null;
    client = null;
    initializingPromise = null;

    if (!manualLogout) {
      scheduleReconnect(reason || "Client disconnected");
    }
  });
}

async function initWhatsAppClient() {
  if (client) {
    return getStatus();
  }

  if (initializingPromise) {
    await initializingPromise;
    return getStatus();
  }

  connectionStatus = "initializing";
  latestError = null;
  manualLogout = false;
  clearReconnectTimer();
  ensureSessionPath();

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: CLIENT_ID,
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  bindClientEvents(client);

  initializingPromise = client.initialize()
    .catch((error) => {
      latestError = error.message;
      connectionStatus = "failed";
      client = null;
      scheduleReconnect(error.message);
      throw error;
    })
    .finally(() => {
      initializingPromise = null;
    });

  await initializingPromise;
  return getStatus();
}

async function ensureClientReady() {
  if (!client && AUTO_INIT && !initializingPromise) {
    try {
      await initWhatsAppClient();
    } catch (_) {
    }
  }

  if (client && connectionStatus === "ready") {
    return;
  }

  await waitForClientReady();

  if (!client || connectionStatus !== "ready") {
    throw new Error("WhatsApp client is not ready yet. Wait a few seconds and try again.");
  }
}

async function getQrCode() {
  return {
    status: connectionStatus,
    qrText: latestQrText,
    qrImage: latestQrImage,
  };
}

async function logoutWhatsApp() {
  manualLogout = true;
  clearReconnectTimer();

  if (!client) {
    connectionStatus = "idle";
    authenticated = false;
    latestQrText = null;
    latestQrImage = null;
    connectedNumber = null;
    return { success: true, status: connectionStatus };
  }

  try {
    await client.logout();
  } catch (_) {
  }

  try {
    await client.destroy();
  } catch (_) {
  }

  client = null;
  initializingPromise = null;
  latestQrText = null;
  latestQrImage = null;
  latestError = null;
  connectionStatus = "idle";
  authenticated = false;
  connectedNumber = null;

  return { success: true, status: connectionStatus };
}

function startWhatsAppAutoInit() {
  if (!AUTO_INIT) {
    return;
  }

  scheduleReconnect("server_boot");
}

async function resolveChatId(phone) {
  await ensureClientReady();

  const normalizedPhone = normalizeWhatsAppPhone(phone);
  const numberId = await client.getNumberId(normalizedPhone);

  if (!numberId?._serialized) {
    throw new Error("This number does not appear to have WhatsApp");
  }

  return {
    phone: normalizedPhone,
    chatId: numberId._serialized,
  };
}

async function sendWhatsAppText(phone, message) {
  if (!message || !String(message).trim()) {
    throw new Error("Message is required");
  }

  const { phone: normalizedPhone, chatId } = await resolveChatId(phone);
  const sentMessage = await client.sendMessage(chatId, String(message).trim());

  return {
    to: normalizedPhone,
    messageId: sentMessage?.id?._serialized || null,
    timestamp: sentMessage?.timestamp || null,
    status: "sent",
  };
}

module.exports = {
  getQrCode,
  getStatus,
  initWhatsAppClient,
  logoutWhatsApp,
  normalizeWhatsAppPhone,
  sendWhatsAppText,
  startWhatsAppAutoInit,
};
