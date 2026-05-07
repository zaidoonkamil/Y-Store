const { Op } = require("sequelize");
const { AgentSubscription, User } = require("../models");
const { getSubscriptionPackage } = require("../constants/subscriptionPackages");
const { sendNotificationToUser } = require("./notifications");
const { sendWhatsAppText } = require("./waSender");

const REMINDER_TITLE = "تنبيه انتهاء الاشتراك";

function buildReminderMessage(user, subscription) {
  const packageLabel = getSubscriptionPackage(subscription.packageType)?.label || "الاشتراك";
  return `عزيزي ${user.name || "التاجر"}، باقي يومين فقط على انتهاء ${packageLabel} الخاص بمتجرك. يرجى تجديد الاشتراك الآن حتى يبقى متجرك فعالاً وتستمر منتجاتك بالظهور بدون انقطاع.`;
}

async function sendSubscriptionExpiryReminders() {
  const now = new Date();
  const twoDaysLater = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const subscriptions = await AgentSubscription.findAll({
    where: {
      isActive: true,
      endsAt: {
        [Op.gt]: now,
        [Op.lte]: twoDaysLater,
      },
      expiryReminderSentAt: {
        [Op.is]: null,
      },
    },
    include: [
      {
        model: User,
        as: "agent",
        attributes: ["id", "name", "phone", "role"],
        where: { role: "agent" },
      },
    ],
  });

  const results = [];

  for (const subscription of subscriptions) {
    const user = subscription.agent;
    const message = buildReminderMessage(user, subscription);

    let pushResult = null;
    let whatsappSent = false;
    let error = null;

    try {
      pushResult = await sendNotificationToUser(user.id, message, REMINDER_TITLE);
    } catch (notificationError) {
      pushResult = { success: false, error: notificationError.message };
    }

    try {
      await sendWhatsAppText(user.phone, message);
      whatsappSent = true;
    } catch (whatsappError) {
      error = whatsappError.message;
    }

    if (pushResult?.success || whatsappSent) {
      subscription.expiryReminderSentAt = new Date();
      await subscription.save();
    }

    results.push({
      subscriptionId: subscription.id,
      userId: user.id,
      phone: user.phone,
      packageType: subscription.packageType,
      endsAt: subscription.endsAt,
      pushSuccess: Boolean(pushResult?.success),
      whatsappSent,
      error,
    });
  }

  return {
    totalMatched: subscriptions.length,
    sent: results.filter((item) => item.pushSuccess || item.whatsappSent).length,
    results,
  };
}

module.exports = {
  sendSubscriptionExpiryReminders,
};
