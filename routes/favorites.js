const express = require("express");
const router = express.Router();
const { Favorite, Product, User} = require("../models");

router.post("/favorites/:userId/add/:productId", async (req, res) => {
  const userId = req.params.userId;
  const productId = req.params.productId;

  try {
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ error: "المنتج غير موجود" });
    }

    const favorite = await Favorite.findOne({ where: { userId, productId } });

    if (favorite) {
      await favorite.destroy();
      return res.status(200).json({ message: "تم حذف المنتج من المفضلة" });
    } else {
      await Favorite.create({ userId, productId });
      return res.status(201).json({ message: "تمت إضافة المنتج إلى المفضلة" });
    }
  } catch (error) {
    console.error("❌ Error toggling favorite:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/favorites/:productId", async (req, res) => {
  const userId = req.user.id;
  const productId = req.body.productId;

  try {
    const favorite = await Favorite.findOne({ where: { userId, productId } });

    if (favorite) {
      return res.status(200).json({ isFavorite: true });
    } else {
      return res.status(200).json({ isFavorite: false });
    }
  } catch (error) {
    console.error("❌ Error checking favorite:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/allfavorites/:id", async (req, res) => {
  const userId = req.params.id;
  try {
    const favorites = await Favorite.findAll({
      where: { userId },
      include: [
        {
          model: Product,
          as: "product",
          attributes: [
            "id", "title", "description", "price", "images",
            "createdAt", "updatedAt", "userId", "categoryId"
          ],
          include: [
            {
              model: User,
              as: "seller",
              attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
            }
          ]
        },
      ],
    });

    const products = favorites.filter(fav => fav.product != null).map(fav => fav.product);

    res.status(200).json({ products });
  } catch (error) {
    console.error("❌ Error fetching favorites:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



module.exports = router;
