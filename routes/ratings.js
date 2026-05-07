const express = require("express");
const { SellerRating, User } = require("../models");
const { getSellerRatingsSummaryMap } = require("../services/sellerRatings");

const router = express.Router();

router.post("/sellers/:sellerId/rate/:userId", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId, 10);
    const userId = parseInt(req.params.userId, 10);
    const ratingValue = parseInt(req.body.rating, 10);

    if (!sellerId || !userId || !ratingValue) {
      return res.status(400).json({ error: "sellerId, userId and rating are required" });
    }

    if (sellerId === userId) {
      return res.status(400).json({ error: "لا يمكن للمستخدم تقييم نفسه" });
    }

    if (ratingValue < 1 || ratingValue > 5) {
      return res.status(400).json({ error: "التقييم يجب أن يكون من 1 إلى 5" });
    }

    const user = await User.findByPk(userId);
    const seller = await User.findByPk(sellerId);

    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    if (!seller || seller.role !== "agent") {
      return res.status(404).json({ error: "التاجر غير موجود" });
    }

    const [sellerRating, created] = await SellerRating.findOrCreate({
      where: { userId, sellerId },
      defaults: { userId, sellerId, rating: ratingValue },
    });

    if (!created) {
      sellerRating.rating = ratingValue;
      await sellerRating.save();
    }

    const ratingsSummaryMap = await getSellerRatingsSummaryMap([sellerId]);
    const summary = ratingsSummaryMap[sellerId] || { average: null, count: 0 };

    return res.status(created ? 201 : 200).json({
      message: created ? "تم تقييم التاجر بنجاح" : "تم تحديث تقييم التاجر بنجاح",
      rating: sellerRating,
      summary: {
        ratingAverage: summary.average,
        ratingsCount: summary.count,
        isRated: Boolean(summary.count),
      },
    });
  } catch (error) {
    console.error("❌ Error rating seller:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/sellers/:sellerId/ratings-summary", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId, 10);
    const seller = await User.findByPk(sellerId);

    if (!seller || seller.role !== "agent") {
      return res.status(404).json({ error: "التاجر غير موجود" });
    }

    const ratingsSummaryMap = await getSellerRatingsSummaryMap([sellerId]);
    const summary = ratingsSummaryMap[sellerId] || { average: null, count: 0 };

    return res.status(200).json({
      sellerId,
      ratingAverage: summary.average,
      ratingsCount: summary.count,
      isRated: Boolean(summary.count),
    });
  } catch (error) {
    console.error("❌ Error fetching ratings summary:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/sellers/:sellerId/ratings", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId, 10);
    const ratings = await SellerRating.findAll({
      where: { sellerId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "name", "image"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({ ratings });
  } catch (error) {
    console.error("❌ Error fetching seller ratings:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/sellers/:sellerId/rating/:userId", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId, 10);
    const userId = parseInt(req.params.userId, 10);

    const rating = await SellerRating.findOne({
      where: { sellerId, userId },
    });

    return res.status(200).json({
      isRatedByUser: Boolean(rating),
      rating: rating ? rating.rating : null,
    });
  } catch (error) {
    console.error("❌ Error fetching user rating for seller:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
