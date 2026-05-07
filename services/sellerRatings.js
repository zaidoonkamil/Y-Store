const { Op } = require("sequelize");
const { SellerRating } = require("../models");

async function getSellerRatingsSummaryMap(sellerIds = []) {
  const uniqueSellerIds = [...new Set(sellerIds.map((id) => parseInt(id, 10)).filter(Boolean))];
  if (uniqueSellerIds.length === 0) {
    return {};
  }

  const ratings = await SellerRating.findAll({
    where: {
      sellerId: {
        [Op.in]: uniqueSellerIds,
      },
    },
    attributes: ["sellerId", "rating"],
  });

  const summaryMap = {};

  for (const rating of ratings) {
    if (!summaryMap[rating.sellerId]) {
      summaryMap[rating.sellerId] = {
        total: 0,
        count: 0,
      };
    }

    summaryMap[rating.sellerId].total += rating.rating;
    summaryMap[rating.sellerId].count += 1;
  }

  for (const sellerId of Object.keys(summaryMap)) {
    const item = summaryMap[sellerId];
    item.average = item.count > 0 ? Number((item.total / item.count).toFixed(2)) : null;
  }

  return summaryMap;
}

module.exports = {
  getSellerRatingsSummaryMap,
};
