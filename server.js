const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sequelize = require("./config/db");

const usersRouter = require("./routes/user");
const adsRouter = require("./routes/ads");
const categoriesRouter = require("./routes/categories");
const favoritedRouter = require("./routes/favorites");
const productsRouter = require("./routes/products");
const orderRouter = require("./routes/order");
const basketRouter = require("./routes/Basket");
const statsRouter = require("./routes/stats");
const notifications = require("./routes/notifications.js");
const chat = require("./routes/chatRoutes");
const whatsappRouter = require("./routes/whatsapp");
const subscriptionsRouter = require("./routes/subscriptions");
const followsRouter = require("./routes/follows");
const ratingsRouter = require("./routes/ratings");
const { sendSubscriptionExpiryReminders } = require("./services/subscriptionReminders");
const { startWhatsAppAutoInit } = require("./services/waSender");

const SUBSCRIPTION_REMINDER_INTERVAL_MS = 12 * 60 * 60 * 1000;

sequelize.sync({ alter: true })
  .then(async () => {
    console.log("Database & tables synced!");

    try {
      const reminderResult = await sendSubscriptionExpiryReminders();
      console.log(`Reminder check completed: ${reminderResult.sent}/${reminderResult.totalMatched}`);
    } catch (error) {
      console.error("Error sending startup subscription reminders:", error.message);
    }

    startWhatsAppAutoInit();
  })
  .catch((err) => {
    console.error("Error syncing database:", err);
  });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
app.use("/uploads", express.static("./uploads"));

app.use("/", usersRouter);
app.use("/", adsRouter);
app.use("/", categoriesRouter);
app.use("/", favoritedRouter);
app.use("/", productsRouter);
app.use("/", orderRouter);
app.use("/", basketRouter);
app.use("/", notifications);
app.use("/", statsRouter);
app.use("/", chat.router);
app.use("/", whatsappRouter);
app.use("/", subscriptionsRouter);
app.use("/", followsRouter);
app.use("/", ratingsRouter);

chat.initChatSocket(io);

setInterval(async () => {
  try {
    const reminderResult = await sendSubscriptionExpiryReminders();
    console.log(`Reminder check completed: ${reminderResult.sent}/${reminderResult.totalMatched}`);
  } catch (error) {
    console.error("Error sending scheduled subscription reminders:", error.message);
  }
}, SUBSCRIPTION_REMINDER_INTERVAL_MS);

server.listen(1009, () => {
  console.log("Server running on http://localhost:1009");
});
