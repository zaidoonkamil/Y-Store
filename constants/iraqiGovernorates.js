const IRAQI_GOVERNORATES = [
  "بغداد",
  "البصرة",
  "نينوى",
  "أربيل",
  "النجف",
  "كربلاء",
  "الأنبار",
  "ديالى",
  "دهوك",
  "السليمانية",
  "صلاح الدين",
  "كركوك",
  "بابل",
  "واسط",
  "ذي قار",
  "ميسان",
  "المثنى",
  "القادسية",
  "حلبجة",
];

function normalizeGovernorate(value = "") {
  return String(value).trim().replace(/\s+/g, " ");
}

function isValidIraqiGovernorate(value = "") {
  return IRAQI_GOVERNORATES.includes(normalizeGovernorate(value));
}

module.exports = {
  IRAQI_GOVERNORATES,
  normalizeGovernorate,
  isValidIraqiGovernorate,
};
