const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const jwt = require("jsonwebtoken");
const { Product, User, SellerFollow, OrderItem, AgentSubscription, Category } = require("../models");
const upload = require("../middlewares/uploads");
const { getActiveSubscriptionForAgent } = require("../services/subscriptions");
const { sendNotificationToUser } = require("../services/notifications");
const { getSellerRatingsSummaryMap } = require("../services/sellerRatings");
const {
  WHOLESALE_LOCATIONS,
  normalizeWholesaleLocation,
  isValidWholesaleLocation,
} = require("../constants/wholesaleLocations");

const DISCOVERY_LIMIT = 20;
const SUBSCRIPTION_PRIORITY = ["yearly", "semiannual", "monthly"];

async function requireAdminOrAgent(req, res, next) {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ error: "Token is missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id, {
      attributes: ["id", "role"],
    });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    if (!["admin", "agent"].includes(user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({ error: "Token is missing" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id, {
      attributes: ["id", "role"],
    });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ error: "Only admin can perform this action" });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function normalizeDiscountInput(discountType, discountValue, basePrice) {
  const normalizedType = String(discountType || "none").trim();
  const numericValue = discountValue === undefined || discountValue === null || discountValue === ""
    ? null
    : Number(discountValue);

  if (!["none", "percentage", "fixed"].includes(normalizedType)) {
    throw new Error("discountType must be one of: none, percentage, fixed");
  }

  if (normalizedType === "none") {
    return {
      discountType: "none",
      discountValue: null,
    };
  }

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error("discountValue must be a positive number");
  }

  if (normalizedType === "percentage" && numericValue >= 100) {
    throw new Error("percentage discount must be less than 100");
  }

  if (normalizedType === "fixed" && numericValue >= Number(basePrice)) {
    throw new Error("fixed discount must be less than product price");
  }

  return {
    discountType: normalizedType,
    discountValue: numericValue,
  };
}

function attachDiscountDetails(productJson) {
  const originalPrice = Number(productJson.price);
  const discountType = productJson.discountType || "none";
  const discountValue = productJson.discountValue;
  let finalPrice = originalPrice;
  let discountAmount = 0;
  let hasDiscount = false;

  if (discountType === "percentage" && Number.isFinite(Number(discountValue))) {
    discountAmount = (originalPrice * Number(discountValue)) / 100;
    finalPrice = originalPrice - discountAmount;
    hasDiscount = discountAmount > 0;
  } else if (discountType === "fixed" && Number.isFinite(Number(discountValue))) {
    discountAmount = Number(discountValue);
    finalPrice = originalPrice - discountAmount;
    hasDiscount = discountAmount > 0;
  }

  productJson.originalPrice = originalPrice;
  productJson.finalPrice = Number(finalPrice.toFixed(2));
  productJson.discountAmount = Number(discountAmount.toFixed(2));
  productJson.hasDiscount = hasDiscount;

  return productJson;
}

async function getFollowersCountMap(sellerIds = []) {
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

function attachFollowersCountToSeller(productJson, followersCountMap = {}) {
  if (productJson?.seller?.id) {
    productJson.seller.followersCount = followersCountMap[productJson.seller.id] || 0;
  }
  return productJson;
}

function attachRatingsToSeller(productJson, ratingsSummaryMap = {}) {
  if (productJson?.seller?.id) {
    const summary = ratingsSummaryMap[productJson.seller.id];
    productJson.seller.ratingAverage = summary?.average ?? null;
    productJson.seller.ratingsCount = summary?.count || 0;
    productJson.seller.isRated = Boolean(summary?.count);
  }
  return productJson;
}

function shuffleArray(items = []) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [result[i], result[randomIndex]] = [result[randomIndex], result[i]];
  }
  return result;
}

async function getActiveSubscriptionMap() {
  const activeSubscriptions = await AgentSubscription.findAll({
    where: {
      isActive: true,
      endsAt: {
        [Op.gt]: new Date(),
      },
    },
    order: [["endsAt", "DESC"]],
  });

  const map = {};
  for (const subscription of activeSubscriptions) {
    if (!map[subscription.agentId]) {
      map[subscription.agentId] = subscription;
    }
  }

  return map;
}

async function enrichProducts(products = []) {
  const sellerIds = products.map((product) => product.seller?.id).filter(Boolean);
  const followersCountMap = await getFollowersCountMap(sellerIds);
  const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

  return products.map((product) =>
    attachDiscountDetails(
      attachRatingsToSeller(
        attachFollowersCountToSeller(product.toJSON(), followersCountMap),
        ratingsSummaryMap
      )
    )
  );
}

async function enrichSellers(sellers = []) {
  const sellerIds = sellers.map((seller) => seller.id).filter(Boolean);
  const followersCountMap = await getFollowersCountMap(sellerIds);
  const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

  return sellers.map((seller) => {
    const sellerJson = seller.toJSON ? seller.toJSON() : seller;
    const ratingSummary = ratingsSummaryMap[seller.id];

    return {
      ...sellerJson,
      followersCount: followersCountMap[seller.id] || 0,
      ratingAverage: ratingSummary?.average ?? null,
      ratingsCount: ratingSummary?.count || 0,
      isRated: Boolean(ratingSummary?.count),
    };
  });
}

function pickBySubscriptionPriority(items, getOwnerId, subscriptionMap, limit = DISCOVERY_LIMIT) {
  const selected = [];
  const selectedIds = new Set();

  for (const packageType of SUBSCRIPTION_PRIORITY) {
    const packageItems = items.filter((item) => {
      const ownerId = getOwnerId(item);
      return subscriptionMap[ownerId]?.packageType === packageType;
    });

    for (const item of shuffleArray(packageItems)) {
      const itemId = item.id;
      if (selectedIds.has(itemId)) continue;
      selected.push(item);
      selectedIds.add(itemId);
      if (selected.length >= limit) {
        return selected;
      }
    }
  }

  const remainingItems = items.filter((item) => !selectedIds.has(item.id));
  for (const item of shuffleArray(remainingItems)) {
    selected.push(item);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function orderBySubscriptionPriority(items, getOwnerId, subscriptionMap) {
  const ordered = [];
  const selectedIds = new Set();

  for (const packageType of SUBSCRIPTION_PRIORITY) {
    for (const item of items) {
      const ownerId = getOwnerId(item);
      if (subscriptionMap[ownerId]?.packageType !== packageType) continue;
      if (selectedIds.has(item.id)) continue;
      ordered.push(item);
      selectedIds.add(item.id);
    }
  }

  for (const item of items) {
    if (selectedIds.has(item.id)) continue;
    ordered.push(item);
  }

  return ordered;
}

function paginateArray(items, page, limit) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const offset = (page - 1) * limit;

  return {
    totalItems,
    totalPages,
    currentPage: page,
    products: items.slice(offset, offset + limit),
  };
}

router.get("/search/products", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    if (query.length < 2) {
      return res.status(400).json({ error: "يجب أن يكون البحث من حرفين على الأقل" });
    }

    const products = await Product.findAll({
      where: {
        [Op.or]: [
          { title: { [Op.like]: `%${query}%` } },
          { description: { [Op.like]: `%${query}%` } },
        ],
      },
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
        },
      ],
      limit,
      order: [["createdAt", "DESC"]],
    });

    const sellerIds = products.map((product) => product.seller?.id).filter(Boolean);
    const followersCountMap = await getFollowersCountMap(sellerIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

    return res.status(200).json({
      query,
      count: products.length,
      products: products.map((product) =>
        attachDiscountDetails(
          attachRatingsToSeller(
            attachFollowersCountToSeller(product.toJSON(), followersCountMap),
            ratingsSummaryMap
          )
        )
      ),
    });
  } catch (error) {
    console.error("❌ Error searching products:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/discover/top-selling", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DISCOVERY_LIMIT, 1), 40);
    const subscriptionMap = await getActiveSubscriptionMap();
    const subscribedSellerIds = Object.keys(subscriptionMap).map(Number);

    if (subscribedSellerIds.length === 0) {
      return res.status(200).json({ totalItems: 0, totalPages: 1, currentPage: page, products: [] });
    }

    const products = await Product.findAll({
      where: {
        userId: {
          [Op.in]: subscribedSellerIds,
        },
      },
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image", "storeActive"],
          where: { storeActive: true },
        },
      ],
    });

    const orderItems = await OrderItem.findAll({
      attributes: ["productId", "quantity"],
    });

    const soldCountMap = orderItems.reduce((acc, item) => {
      acc[item.productId] = (acc[item.productId] || 0) + Number(item.quantity || 0);
      return acc;
    }, {});

    const sortedProducts = [...products].sort((a, b) => {
      const soldA = soldCountMap[a.id] || 0;
      const soldB = soldCountMap[b.id] || 0;
      return soldB - soldA;
    });

    const orderedProducts = orderBySubscriptionPriority(
      sortedProducts,
      (product) => product.userId,
      subscriptionMap
    );
    const pageData = paginateArray(orderedProducts, page, limit);

    return res.status(200).json({
      ...pageData,
      products: await enrichProducts(pageData.products),
    });
  } catch (error) {
    console.error("❌ Error fetching top selling products:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/discover/cheapest", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DISCOVERY_LIMIT, 1), 40);
    const products = await Product.findAll({
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image", "storeActive"],
          where: { role: "agent", storeActive: true },
        },
      ],
      order: [["price", "ASC"]],
    });

    const enrichedProducts = await enrichProducts(products);
    const sortedByFinalPrice = enrichedProducts.sort((a, b) => a.finalPrice - b.finalPrice);
    const pageData = paginateArray(sortedByFinalPrice, page, limit);

    return res.status(200).json(pageData);
  } catch (error) {
    console.error("❌ Error fetching cheapest products:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/discover/discounted", async (req, res) => {
  try {
    const products = await Product.findAll({
      where: {
        discountType: {
          [Op.ne]: "none",
        },
      },
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image", "storeActive"],
        },
      ],
      limit: 100,
      order: [["updatedAt", "DESC"]],
    });

    const enrichedProducts = await enrichProducts(products);
    const discountedProducts = enrichedProducts.filter((product) => product.hasDiscount);
    const selectedProducts = shuffleArray(discountedProducts).slice(0, DISCOVERY_LIMIT);

    return res.status(200).json({ products: selectedProducts });
  } catch (error) {
    console.error("❌ Error fetching discounted products:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/discover/featured-stores", async (req, res) => {
  try {
    const sellers = await User.findAll({
      where: {
        role: "agent",
        storeActive: true,
        isFeaturedSeller: true,
      },
      order: [["createdAt", "DESC"]],
    });

    const enrichedSellers = await enrichSellers(sellers);

    return res.status(200).json({
      sellers: enrichedSellers,
    });
  } catch (error) {
    console.error("❌ Error fetching featured stores:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/sellers/:sellerId/featured", requireAdmin, async (req, res) => {
  try {
    const seller = await User.findByPk(req.params.sellerId);
    if (!seller || seller.role !== "agent") {
      return res.status(404).json({ error: "التاجر غير موجود" });
    }

    const isFeaturedSeller =
      req.body.isFeaturedSeller === undefined
        ? !seller.isFeaturedSeller
        : req.body.isFeaturedSeller === true || req.body.isFeaturedSeller === "true";

    await seller.update({ isFeaturedSeller });

    return res.status(200).json({
      message: isFeaturedSeller ? "تمت إضافة التاجر للمميزين" : "تمت إزالة التاجر من المميزين",
      seller,
    });
  } catch (error) {
    console.error("❌ Error updating featured seller:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/products", upload.array("images", 5), async (req, res) => {
    const { title, description, price, userId, categoryId} = req.body;

    if (!title || !price) {
      return res.status(400).json({ error: "العنوان والسعر مطلوبان" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "يجب رفع صورة واحدة على الأقل" });
    }

    try {
      const seller = await User.findByPk(userId);
      const isWholesaleSeller = seller?.role === "wholesale_seller";
      if (!seller) {
        return res.status(404).json({ error: "التاجر غير موجود" });
      }

      if (seller.role !== "agent" && !isWholesaleSeller) {
        return res.status(403).json({ error: "Only agents and wholesale sellers can create products" });
      }

      let category = null;
      if (!isWholesaleSeller) {
        category = await Category.findByPk(categoryId, {
          include: [
            {
              model: Category,
              as: "subcategories",
              required: false,
              attributes: ["id"],
            },
          ],
        });

      if (!isWholesaleSeller && !category) {
        return res.status(404).json({ error: "القسم غير موجود" });
      }

      if (!isWholesaleSeller && category.subcategories?.length > 0) {
        return res.status(400).json({ error: "يجب اختيار قسم فرعي لإضافة المنتج" });
      }

      }

      if (seller.role === "agent") {
        const activeSubscription = await getActiveSubscriptionForAgent(seller.id);

        if (!seller.storeActive || !activeSubscription) {
          return res.status(403).json({
            error: "المتجر غير مفعل. يجب الموافقة على اشتراك التاجر أولاً",
          });
        }
      }

      const images = req.files.map((file) => file.filename);

      const product = await Product.create({
        title,
        description,
        price,
        images,
        userId,
        categoryId: isWholesaleSeller ? null : categoryId,
      });

      const followers = await SellerFollow.findAll({
        where: { sellerId: seller.id },
        attributes: ["userId"],
      });

      const followerIds = [...new Set(followers.map((follow) => follow.userId))];
      const notificationTitle = "منتج جديد من تاجر تتابعه";
      const notificationMessage = `التاجر ${seller.name} أضاف منتجاً جديداً بعنوان: ${title}`;

      await Promise.all(
        followerIds.map((followerId) =>
          sendNotificationToUser(followerId, notificationMessage, notificationTitle).catch((error) => {
            console.error(`❌ Error notifying follower ${followerId}:`, error.message);
            return null;
          })
        )
      );

      const createdProduct = await Product.findByPk(product.id, {
        include: [
          {
            model: User,
            as: "seller",
            attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
          },
          {
            model: Category,
            as: "category",
            include: [
              {
                model: Category,
                as: "parent",
                required: false,
                attributes: ["id", "name", "parentId", "images"],
              },
            ],
          },
        ],
      });

      res.status(201).json(attachDiscountDetails(createdProduct.toJSON()));
    } catch (error) {
      console.error("❌ Error creating product:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.patch("/products/:id/discount", async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "المنتج غير موجود" });
    }

    const discountData = normalizeDiscountInput(
      req.body.discountType,
      req.body.discountValue,
      product.price
    );

    await product.update(discountData);

    return res.status(200).json({
      message: discountData.discountType === "none"
        ? "تمت إزالة الخصم من المنتج"
        : "تم تحديث خصم المنتج بنجاح",
      product: attachDiscountDetails(product.toJSON()),
    });
  } catch (error) {
    console.error("❌ Error updating product discount:", error.message);
    return res.status(400).json({ error: error.message || "حدث خطأ أثناء تحديث الخصم" });
  }
});

router.patch("/sellers/:sellerId/products/discount", async (req, res) => {
  try {
    const seller = await User.findByPk(req.params.sellerId);
    if (!seller || seller.role !== "agent") {
      return res.status(404).json({ error: "التاجر غير موجود" });
    }

    const products = await Product.findAll({
      where: { userId: seller.id },
    });

    if (products.length === 0) {
      return res.status(404).json({ error: "لا توجد منتجات لهذا التاجر" });
    }

    const preparedDiscounts = products.map((product) => ({
      product,
      discountData: normalizeDiscountInput(
        req.body.discountType,
        req.body.discountValue,
        product.price
      ),
    }));

    const updatedProducts = [];
    for (const { product, discountData } of preparedDiscounts) {
      await product.update(discountData);
      updatedProducts.push(attachDiscountDetails(product.toJSON()));
    }

    return res.status(200).json({
      message:
        String(req.body.discountType || "none").trim() === "none"
          ? "تمت إزالة الخصم من جميع منتجات التاجر"
          : "تم تطبيق الخصم على جميع منتجات التاجر",
      totalUpdated: updatedProducts.length,
      products: updatedProducts,
    });
  } catch (error) {
    console.error("❌ Error updating seller products discount:", error.message);
    return res.status(400).json({ error: error.message || "حدث خطأ أثناء تحديث الخصومات" });
  }
});

router.get("/products/admin/all", requireAdmin, async (req, res) => {
  try {
    let { page, limit } = req.query;
    page = parseInt(page, 10) || 1;
    limit = Math.min(parseInt(limit, 10) || 20, 60);
    const offset = (page - 1) * limit;

    const { count, rows: products } = await Product.findAndCountAll({
      include: [
        {
          model: User,
          as: "seller",
          attributes: [
            "id",
            "name",
            "phone",
            "location",
            "role",
            "isVerified",
            "image",
            "storeActive",
            "isFeaturedSeller",
          ],
        },
        {
          model: Category,
          as: "category",
          required: false,
          include: [
            {
              model: Category,
              as: "parent",
              required: false,
              attributes: ["id", "name", "parentId", "images"],
            },
          ],
        },
      ],
      limit,
      offset,
      order: [["updatedAt", "DESC"]],
    });

    return res.status(200).json({
      totalItems: count,
      totalPages: Math.max(1, Math.ceil(count / limit)),
      currentPage: page,
      products: await enrichProducts(products),
    });
  } catch (error) {
    console.error("❌ Error fetching admin products:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/products/featured", async (req, res) => {
  try {
    let { page, limit, userId } = req.query;
    page = parseInt(page, 10) || 1;
    limit = Math.min(parseInt(limit, 10) || 20, 40);
    userId = userId || 0;
    const offset = (page - 1) * limit;

    const { count, rows: products } = await Product.findAndCountAll({
      where: { isFeatured: true },
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image", "storeActive"],
          where: { role: "agent", storeActive: true },
        },
        {
          model: Category,
          as: "category",
          required: false,
          include: [
            {
              model: Category,
              as: "parent",
              required: false,
              attributes: ["id", "name", "parentId", "images"],
            },
          ],
        },
        {
          model: User,
          as: "favoritedByUsers",
          where: { id: userId },
          required: false,
          attributes: ["id"],
          through: { attributes: [] },
        },
      ],
      limit,
      offset,
      order: [["updatedAt", "DESC"]],
    });

    const sellerIds = products.map((product) => product.seller?.id).filter(Boolean);
    const followersCountMap = await getFollowersCountMap(sellerIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

    const productsWithFavorite = products.map((product) => {
      const isFavorite = product.favoritedByUsers && product.favoritedByUsers.length > 0;
      const productJson = product.toJSON();
      productJson.isFavorite = isFavorite;
      delete productJson.favoritedByUsers;
      return attachDiscountDetails(
        attachRatingsToSeller(attachFollowersCountToSeller(productJson, followersCountMap), ratingsSummaryMap)
      );
    });

    return res.status(200).json({
      totalItems: count,
      totalPages: Math.max(1, Math.ceil(count / limit)),
      currentPage: page,
      products: productsWithFavorite,
    });
  } catch (error) {
    console.error("❌ Error fetching featured products:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/products/:id/featured", requireAdmin, async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "المنتج غير موجود" });
    }

    const isFeatured =
      req.body.isFeatured === undefined
        ? !product.isFeatured
        : req.body.isFeatured === true || req.body.isFeatured === "true";

    await product.update({ isFeatured });

    return res.status(200).json({
      message: isFeatured ? "تمت إضافة المنتج للمميزين" : "تمت إزالة المنتج من المميزين",
      product: attachDiscountDetails(product.toJSON()),
    });
  } catch (error) {
    console.error("❌ Error updating featured product:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/products/:id", async (req, res) => {
  const userId = req.params.id; 

  try {
    let { page, limit } = req.query;
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 40;
    const offset = (page - 1) * limit;

    const { count, rows: products } = await Product.findAndCountAll({
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
        },
        {
          model: Category,
          as: "category",
          include: [
            {
              model: Category,
              as: "parent",
              required: false,
              attributes: ["id", "name", "parentId", "images"],
            },
          ],
        },
        {
          model: User,
          as: "favoritedByUsers",
          where: { id: userId },
          required: false,   
          attributes: ["id"],
          through: { attributes: [] }, 
        },
      ],
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    const sellerIds = products.map((product) => product.seller?.id).filter(Boolean);
    const followersCountMap = await getFollowersCountMap(sellerIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

    const productsWithFavorite = products.map(product => {
      const isFavorite = product.favoritedByUsers && product.favoritedByUsers.length > 0;
      const prodJson = product.toJSON();
      prodJson.isFavorite = isFavorite;
      delete prodJson.favoritedByUsers;
      return attachDiscountDetails(
        attachRatingsToSeller(attachFollowersCountToSeller(prodJson, followersCountMap), ratingsSummaryMap)
      );
    });

    const totalPages = Math.ceil(count / limit);

    res.json({
      totalItems: count,
      totalPages,
      currentPage: page,
      products: productsWithFavorite,
    });
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/productItem/:id", async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
        },
        {
          model: Category,
          as: "category",
          include: [
            {
              model: Category,
              as: "parent",
              required: false,
              attributes: ["id", "name", "parentId", "images"],
            },
          ],
        },
      ],
    });

    if (!product) {
      return res.status(404).json({ error: "المنتج غير موجود" });
    }

    const productJson = product.toJSON();
    const sellerIds = [productJson.seller?.id].filter(Boolean);
    const followersCountMap = await getFollowersCountMap(sellerIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);
    res.json(
      attachDiscountDetails(
        attachRatingsToSeller(attachFollowersCountToSeller(productJson, followersCountMap), ratingsSummaryMap)
      )
    );
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/products/:id", async (req, res) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) {
      return res.status(404).json({ error: "المنتج غير موجود" });
    }

    await product.destroy();
    res.status(204).send();
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/products/seller/:sellerId", async (req, res) => {
  const sellerId = req.params.sellerId;

  try {
    let { page, limit } = req.query;
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    const offset = (page - 1) * limit;

    const { count, rows: products } = await Product.findAndCountAll({
      where: { userId: sellerId }, 
      include: [
        {
          model: User,
          as: "seller",
          attributes: [
            "id",
            "name",
            "phone",
            "location",
            "role",
            "isVerified",
            "image",
          ],
        },
        {
          model: Category,
          as: "category",
          include: [
            {
              model: Category,
              as: "parent",
              required: false,
              attributes: ["id", "name", "parentId", "images"],
            },
          ],
        },
      ],
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    const totalPages = Math.ceil(count / limit);
    const sellerIds = products.map((product) => product.seller?.id).filter(Boolean);
    const followersCountMap = await getFollowersCountMap(sellerIds);
    const ratingsSummaryMap = await getSellerRatingsSummaryMap(sellerIds);

    res.json({
      totalItems: count,
      totalPages,
      currentPage: page,
      products: products.map((product) =>
        attachRatingsToSeller(
          attachFollowersCountToSeller(product.toJSON(), followersCountMap),
          ratingsSummaryMap
        )
      ).map(attachDiscountDetails),
    });
  } catch (error) {
    console.error("❌ Error fetching seller products:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/wholesale-sellers/products", requireAdminOrAgent, async (req, res) => {
  try {
    const location = normalizeWholesaleLocation(req.query.location);

    if (location && !isValidWholesaleLocation(location)) {
      return res.status(400).json({
        error: "location must be one of: بغداد, أربيل, تركيا",
        allowedLocations: WHOLESALE_LOCATIONS,
      });
    }

    const sellerWhere = { role: "wholesale_seller" };
    if (location) {
      sellerWhere.location = location;
    }

    const products = await Product.findAll({
      include: [
        {
          model: User,
          as: "seller",
          where: sellerWhere,
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
        },
        {
          model: Category,
          as: "category",
          required: false,
          include: [
            {
              model: Category,
              as: "parent",
              required: false,
              attributes: ["id", "name", "parentId", "images"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      count: products.length,
      products: await enrichProducts(products),
    });
  } catch (error) {
    console.error("❌ Error fetching wholesale seller products:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/wholesale-sellers/:sellerId/products", requireAdminOrAgent, async (req, res) => {
  try {
    const seller = await User.findByPk(req.params.sellerId, {
      attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
    });

    if (!seller || seller.role !== "wholesale_seller") {
      return res.status(404).json({ error: "بائع الجملة غير موجود" });
    }

    const products = await Product.findAll({
      where: { userId: seller.id },
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
        },
        {
          model: Category,
          as: "category",
          required: false,
          include: [
            {
              model: Category,
              as: "parent",
              required: false,
              attributes: ["id", "name", "parentId", "images"],
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    return res.status(200).json({
      seller,
      count: products.length,
      products: await enrichProducts(products),
    });
  } catch (error) {
    console.error("❌ Error fetching wholesale seller products by seller:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
