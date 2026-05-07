const express = require("express");
const { SellerFollow, User } = require("../models");
const { getSellerRatingsSummaryMap } = require("../services/sellerRatings");

const router = express.Router();

router.post("/sellers/:sellerId/follow/:userId", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId, 10);
    const userId = parseInt(req.params.userId, 10);

    if (!sellerId || !userId) {
      return res.status(400).json({ error: "sellerId and userId are required" });
    }

    if (sellerId === userId) {
      return res.status(400).json({ error: "لا يمكن للمستخدم متابعة نفسه" });
    }

    const user = await User.findByPk(userId);
    const seller = await User.findByPk(sellerId);

    if (!user) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    if (!seller || seller.role !== "agent") {
      return res.status(404).json({ error: "التاجر غير موجود" });
    }

    const [follow, created] = await SellerFollow.findOrCreate({
      where: { userId, sellerId },
      defaults: { userId, sellerId },
    });

    return res.status(created ? 201 : 200).json({
      message: created ? "تمت متابعة التاجر بنجاح" : "المستخدم متابع لهذا التاجر مسبقاً",
      follow,
    });
  } catch (error) {
    console.error("❌ Error following seller:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/sellers/:sellerId/follow/:userId", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId, 10);
    const userId = parseInt(req.params.userId, 10);

    const follow = await SellerFollow.findOne({
      where: { userId, sellerId },
    });

    if (!follow) {
      return res.status(404).json({ error: "المتابعة غير موجودة" });
    }

    await follow.destroy();
    return res.status(200).json({ message: "تم إلغاء متابعة التاجر بنجاح" });
  } catch (error) {
    console.error("❌ Error unfollowing seller:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/users/:userId/followed-sellers", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const follows = await SellerFollow.findAll({
      where: { userId },
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const sellerIds = follows.map((follow) => follow.seller?.id).filter(Boolean);
    const followers = sellerIds.length
      ? await SellerFollow.findAll({
          where: { sellerId: sellerIds },
          attributes: ["sellerId"],
        })
      : [];

    const followersCountMap = followers.reduce((acc, follow) => {
      acc[follow.sellerId] = (acc[follow.sellerId] || 0) + 1;
      return acc;
    }, {});
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

    return res.status(200).json({
      sellers: follows
        .map((follow) => {
          const seller = follow.seller?.toJSON ? follow.seller.toJSON() : follow.seller;
          if (!seller) return null;
          return {
            ...seller,
            followersCount: followersCountMap[seller.id] || 0,
            ratingAverage: ratingsSummaryMap[seller.id]?.average ?? null,
            ratingsCount: ratingsSummaryMap[seller.id]?.count || 0,
            isRated: Boolean(ratingsSummaryMap[seller.id]?.count),
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    console.error("❌ Error fetching followed sellers:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/sellers/:sellerId/follow-status/:userId", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId, 10);
    const userId = parseInt(req.params.userId, 10);

    const follow = await SellerFollow.findOne({
      where: { userId, sellerId },
    });

    return res.status(200).json({ isFollowing: Boolean(follow) });
  } catch (error) {
    console.error("❌ Error fetching follow status:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/sellers/:sellerId/followers-count", async (req, res) => {
  try {
    const sellerId = parseInt(req.params.sellerId, 10);
    const followersCount = await SellerFollow.count({
      where: { sellerId },
    });

    return res.status(200).json({ sellerId, followersCount });
  } catch (error) {
    console.error("❌ Error fetching followers count:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
