const express = require("express");
const { Op } = require("sequelize");
const router = express.Router();
const { Category, Product, User } = require("../models");
const upload = require("../middlewares/uploads");
const { getSellerRatingsSummaryMap } = require("../services/sellerRatings");

async function getFollowersCountMap(sellerIds = []) {
  const { SellerFollow } = require("../models");
  const uniqueSellerIds = [...new Set(sellerIds.map((id) => parseInt(id, 10)).filter(Boolean))];
  if (uniqueSellerIds.length === 0) {
    return {};
  }

  const follows = await SellerFollow.findAll({
    where: {
      sellerId: {
        [Op.in]: uniqueSellerIds,
      },
    },
    attributes: ["sellerId"],
  });

  return follows.reduce((acc, follow) => {
    acc[follow.sellerId] = (acc[follow.sellerId] || 0) + 1;
    return acc;
  }, {});
}

function attachSellerStats(productJson, followersCountMap = {}, ratingsSummaryMap = {}) {
  if (productJson?.seller?.id) {
    productJson.seller.followersCount = followersCountMap[productJson.seller.id] || 0;
    const ratingSummary = ratingsSummaryMap[productJson.seller.id];
    productJson.seller.ratingAverage = ratingSummary?.average ?? null;
    productJson.seller.ratingsCount = ratingSummary?.count || 0;
    productJson.seller.isRated = Boolean(ratingSummary?.count);
  }

  return productJson;
}

function formatCategoryTree(category) {
  const categoryJson = category.toJSON ? category.toJSON() : category;
  return {
    ...categoryJson,
    isPrimary: !categoryJson.parentId,
    subcategories: Array.isArray(categoryJson.subcategories)
      ? categoryJson.subcategories.map(formatCategoryTree)
      : [],
  };
}

router.post("/categories", upload.array("images", 5), async (req, res) => {
  const { name, parentId } = req.body;

  if (!name) {
    return res.status(400).json({ error: "اسم القسم مطلوب" });
  }

  try {
    let parentCategory = null;
    const normalizedParentId = parentId ? parseInt(parentId, 10) : null;

    if (normalizedParentId) {
      parentCategory = await Category.findByPk(normalizedParentId);
      if (!parentCategory) {
        return res.status(404).json({ error: "القسم الرئيسي غير موجود" });
      }

      if (parentCategory.parentId) {
        return res.status(400).json({ error: "لا يمكن إضافة قسم فرعي داخل قسم فرعي آخر" });
      }
    }

    if (!normalizedParentId && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ error: "يجب رفع صورة واحدة على الأقل للقسم الرئيسي" });
    }

    const images = req.files?.length ? req.files.map((file) => file.filename) : null;

    const category = await Category.create({
      name,
      parentId: normalizedParentId,
      images,
    });

    return res.status(201).json({
      ...category.toJSON(),
      isPrimary: !category.parentId,
      parent: parentCategory,
      subcategories: [],
    });
  } catch (error) {
    console.error("❌ Error creating category:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const categories = await Category.findAll({
      where: { parentId: null },
      include: [
        {
          model: Category,
          as: "subcategories",
          required: false,
          order: [["createdAt", "ASC"]],
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    return res.status(200).json(categories.map(formatCategoryTree));
  } catch (error) {
    console.error("❌ Error fetching categories:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/categories/:id", async (req, res) => {
  try {
    const category = await Category.findByPk(req.params.id, {
      include: [
        {
          model: Category,
          as: "subcategories",
          required: false,
        },
        {
          model: Category,
          as: "parent",
          required: false,
        },
      ],
    });

    if (!category) {
      return res.status(404).json({ error: "القسم غير موجود" });
    }

    return res.status(200).json(formatCategoryTree(category));
  } catch (error) {
    console.error("❌ Error fetching category:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/categories/:id/products", async (req, res) => {
  const categoryId = parseInt(req.params.id, 10);
  const userId = parseInt(req.query.userId, 10) || null;
  let page = parseInt(req.query.page, 10) || 1;
  let pageSize = parseInt(req.query.pageSize, 10) || 10;

  const offset = (page - 1) * pageSize;
  const limit = pageSize;

  try {
    const category = await Category.findByPk(categoryId, {
      include: [
        {
          model: Category,
          as: "subcategories",
          required: false,
          attributes: ["id"],
        },
      ],
    });

    if (!category) {
      return res.status(404).json({ error: "القسم غير موجود" });
    }

    const targetCategoryIds = category.subcategories?.length
      ? [category.id, ...category.subcategories.map((subcat) => subcat.id)]
      : [category.id];

    const include = [
      {
        model: User,
        as: "seller",
        attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
      },
      {
        model: Category,
        as: "category",
        attributes: ["id", "name", "parentId", "images"],
      },
    ];

    if (userId) {
      include.push({
        model: User,
        as: "favoritedByUsers",
        where: { id: userId },
        required: false,
        attributes: ["id"],
        through: { attributes: [] },
      });
    }

    const { rows: products, count } = await Product.findAndCountAll({
      where: {
        categoryId: {
          [Op.in]: targetCategoryIds,
        },
      },
      include,
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    const sellerIds = products.map((product) => product.seller?.id).filter(Boolean);
    const followersCountMap = await getFollowersCountMap(sellerIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

    const productsWithFavorite = products.map((product) => {
      const isFavorite = product.favoritedByUsers && product.favoritedByUsers.length > 0;
      const productJson = product.toJSON();
      productJson.isFavorite = isFavorite;
      delete productJson.favoritedByUsers;
      return attachSellerStats(productJson, followersCountMap, ratingsSummaryMap);
    });

    return res.status(200).json({
      page,
      pageSize,
      totalItems: count,
      totalPages: Math.ceil(count / pageSize),
      category: formatCategoryTree(category),
      products: productsWithFavorite,
    });
  } catch (error) {
    console.error("❌ Error fetching products for category:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/categories/:id", async (req, res) => {
  try {
    const category = await Category.findByPk(req.params.id, {
      include: [
        {
          model: Category,
          as: "subcategories",
          required: false,
        },
      ],
    });

    if (!category) {
      return res.status(404).json({ error: "القسم غير موجود" });
    }

    await category.destroy();
    return res.status(200).json({ message: "تم حذف القسم بنجاح" });
  } catch (error) {
    console.error("❌ Error deleting category:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
