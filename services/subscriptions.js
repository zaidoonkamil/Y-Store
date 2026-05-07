const { AgentSubscription, User } = require("../models");
const { getSubscriptionPackage } = require("../constants/subscriptionPackages");

function calculateSubscriptionEndDate(startsAt, durationMonths) {
  const endDate = new Date(startsAt);
  endDate.setMonth(endDate.getMonth() + durationMonths);
  return endDate;
}

async function deactivateExpiredSubscriptionForAgent(agentId) {
  const currentSubscription = await AgentSubscription.findOne({
    where: {
      agentId,
      isActive: true,
    },
    order: [["endsAt", "DESC"]],
  });

  if (!currentSubscription) {
    await User.update({ storeActive: false }, { where: { id: agentId } });
    return null;
  }

  if (new Date(currentSubscription.endsAt) <= new Date()) {
    currentSubscription.isActive = false;
    await currentSubscription.save();
    await User.update({ storeActive: false }, { where: { id: agentId } });
    return null;
  }

  return currentSubscription;
}

async function activateSubscription({
  agentId,
  packageType,
  approvedBy,
  requestId = null,
}) {
  const packageConfig = getSubscriptionPackage(packageType);
  if (!packageConfig) {
    throw new Error("Invalid subscription package");
  }

  await AgentSubscription.update(
    { isActive: false },
    {
      where: {
        agentId,
        isActive: true,
      },
    }
  );

  const startsAt = new Date();
  const endsAt = calculateSubscriptionEndDate(startsAt, packageConfig.durationMonths);

  const subscription = await AgentSubscription.create({
    agentId,
    packageType,
    startsAt,
    endsAt,
    isActive: true,
    expiryReminderSentAt: null,
    approvedBy,
    requestId,
  });

  await User.update({ storeActive: true }, { where: { id: agentId } });

  return subscription;
}

async function getActiveSubscriptionForAgent(agentId) {
  await deactivateExpiredSubscriptionForAgent(agentId);

  return AgentSubscription.findOne({
    where: {
      agentId,
      isActive: true,
    },
    order: [["endsAt", "DESC"]],
  });
}

module.exports = {
  activateSubscription,
  getActiveSubscriptionForAgent,
  deactivateExpiredSubscriptionForAgent,
};
