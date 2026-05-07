const WHOLESALE_LOCATIONS = ["بغداد", "أربيل", "تركيا"];

function normalizeWholesaleLocation(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

function isValidWholesaleLocation(value = "") {
  return WHOLESALE_LOCATIONS.includes(normalizeWholesaleLocation(value));
}

module.exports = {
  WHOLESALE_LOCATIONS,
  normalizeWholesaleLocation,
  isValidWholesaleLocation,
};
