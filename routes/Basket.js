const express = require("express");
const router = express.Router();
const { Basket, BasketItem, Product } = require("../models");
const multer = require("multer");
const uploads = multer();

router.post("/basket", uploads.none(), async (req, res) => {
  let { productId, quantity, userId } = req.body;

  productId = parseInt(productId);
  quantity = parseInt(quantity) || 1;

  if (!productId) {
    return res.status(400).json({ error: "يجب تحديد المنتج" });
  }

  try {
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).json({ error: "المنتج غير موجود" });
    }

    let basket = await Basket.findOne({ where: { userId } });
    if (!basket) {
      basket = await Basket.create({ userId });
    }

    const basketItems = await BasketItem.findAll({
      where: { basketId: basket.id },
      include: [{ model: Product, attributes: ["userId"] }],
    });

    if (basketItems.length > 0) {
      const currentSellerId = basketItems[0].Product.userId;
      if (product.userId !== currentSellerId) {
        return res.status(400).json({ error: "لا يمكن إضافة منتجات من تجار مختلفين في نفس السلة" });
      }
    }

    let basketItem = await BasketItem.findOne({
      where: { basketId: basket.id, productId },
    });

    if (basketItem) {
      basketItem.quantity += quantity;
      await basketItem.save();
    } else {
      basketItem = await BasketItem.create({
        basketId: basket.id,
        productId,
        quantity,
      });
    }

    res.status(200).json({ message: "تمت إضافة المنتج للسلة", basketItem });
  } catch (error) {
    console.error("❌ Error adding to basket:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/basket/:id", uploads.none(), async (req, res) => {
  const userId = req.params.id;

  try {
    const basket = await Basket.findOne({ where: { userId } });

    // لو ما فيه سلة نرجع مصفوفة فارغة
    if (!basket) {
      return res.status(200).json([]);
    }

    const basketItems = await BasketItem.findAll({
      where: { basketId: basket.id },
      include: [{ model: Product, attributes: ['id', 'title', 'price', 'images'] }],
    });

    // نُعيد العناصر كـ JSON عادي (بدون حقل basket)
    const items = basketItems.map(item => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      product: item.Product ? item.Product.toJSON() : null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

    return res.status(200).json(items);
  } catch (error) {
    console.error("❌ Error fetching basket:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/basket/:userId/item/:id", uploads.none(), async (req, res) => {
  const userId = req.params.userId;
  const itemId = req.params.id;
  try {
    const basket = await Basket.findOne({ where: { userId } });
    if (!basket) {
      return res.status(404).json({ error: "السلة غير موجودة" });
    }

    const basketItem = await BasketItem.findOne({ where: { id: itemId, basketId: basket.id } });
    if (!basketItem) {
      return res.status(404).json({ error: "عنصر السلة غير موجود" });
    }

    await basketItem.destroy();
    res.status(200).json({ message: "تم حذف العنصر من السلة" });
  } catch (error) {
    console.error("❌ Error deleting basket item:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


module.exports = router;
