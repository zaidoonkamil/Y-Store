const SUBSCRIPTION_PACKAGES = {
  monthly: {
    key: "monthly",
    label: "اشتراك شهري",
    durationMonths: 1,
  },
  semiannual: {
    key: "semiannual",
    label: "اشتراك 6 اشهر",
    durationMonths: 6,
  },
  yearly: {
    key: "yearly",
    label: "اشتراك سنوي",
    durationMonths: 12,
  },
};

function isValidSubscriptionPackage(packageKey = "") {
  return Boolean(SUBSCRIPTION_PACKAGES[packageKey]);
}

function getSubscriptionPackage(packageKey = "") {
  return SUBSCRIPTION_PACKAGES[packageKey] || null;
}

module.exports = {
  SUBSCRIPTION_PACKAGES,
  isValidSubscriptionPackage,
  getSubscriptionPackage,
};
