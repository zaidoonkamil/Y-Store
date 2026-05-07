const express = require("express");
const multer = require("multer");
const { Op } = require("sequelize");
const { Order, OrderItem, Product, Basket, BasketItem, User } = require("../models");
const { sendNotificationToUser } = require("../services/notifications");
const {
  isValidIraqiGovernorate,
  normalizeGovernorate,
  IRAQI_GOVERNORATES,
} = require("../constants/iraqiGovernorates");

const router = express.Router();
const uploads = multer();
const ORDER_STATUSES = ["قيد الانتضار", "قيد التوصيل", "مكتمل", "ملغي"];
const ACTIVE_DELIVERY_STATUSES = ["قيد الانتضار", "قيد التوصيل"];

function buildOrderInclude() {
  return [
    {
      model: User,
      as: "user",
      attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
    },
    {
      model: User,
      as: "seller",
      attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
    },
    {
      model: User,
      as: "deliveryCompany",
      attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
    },
    {
      model: OrderItem,
      include: [
        {
          model: Product,
          attributes: ["id", "title", "price", "images", "userId"],
        },
      ],
    },
  ];
}

function serializeOrder(order) {
  const orderJson = order.toJSON ? order.toJSON() : order;
  const items = Array.isArray(orderJson.OrderItems) ? orderJson.OrderItems : [];
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice =
    orderJson.totalPrice ??
    items.reduce((sum, item) => sum + item.quantity * item.priceAtOrder, 0);

  return {
    id: orderJson.id,
    phone: orderJson.phone,
    address: orderJson.address,
    governorate: orderJson.governorate,
    status: orderJson.status,
    totalItems,
    totalPrice,
    createdAt: orderJson.createdAt,
    updatedAt: orderJson.updatedAt,
    user: orderJson.user || null,
    seller: orderJson.seller || null,
    deliveryCompany: orderJson.deliveryCompany || null,
    items: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      priceAtOrder: item.priceAtOrder,
      product: item.Product || null,
    })),
  };
}

async function getLeastBusyDeliveryCompany(governorate) {
  const companies = await User.findAll({
    where: {
      role: "delivery_company",
      location: governorate,
      isVerified: true,
    },
    attributes: ["id", "name", "phone", "location", "role", "isVerified", "image", "createdAt"],
    order: [["createdAt", "ASC"]],
  });

  if (companies.length === 0) {
    return null;
  }

  let selectedCompany = companies[0];
  let selectedLoad = Number.MAX_SAFE_INTEGER;

  for (const company of companies) {
    const activeOrdersCount = await Order.count({
      where: {
        deliveryCompanyId: company.id,
        status: {
          [Op.in]: ACTIVE_DELIVERY_STATUSES,
        },
      },
    });

    if (activeOrdersCount < selectedLoad) {
      selectedCompany = company;
      selectedLoad = activeOrdersCount;
    }
  }

  return selectedCompany;
}

async function sendOrderCreatedNotifications(order) {
  const buyerMessage = `تم إنشاء طلبك رقم ${order.id} وربطه بشركة التوصيل ${order.deliveryCompany?.name || ""}.`;
  const sellerMessage = `تم استلام طلب جديد رقم ${order.id} وسيتم التنسيق مع شركة التوصيل ${order.deliveryCompany?.name || ""}.`;
  const companyMessage =
    `تم تحويل طلب جديد رقم ${order.id} إليك من التاجر ${order.seller?.name || ""} باتجاه ${order.governorate}.`;

  await Promise.allSettled([
    sendNotificationToUser(order.userId, buyerMessage, "طلب جديد"),
    sendNotificationToUser(order.sellerId, sellerMessage, "طلب جديد"),
    sendNotificationToUser(order.deliveryCompanyId, companyMessage, "طلب جديد"),
  ]);
}

async function sendOrderStatusNotifications(order) {
  const buyerMessage = `تم تحديث حالة طلبك رقم ${order.id} إلى ${order.status}.`;
  const sellerMessage = `تم تحديث حالة الطلب رقم ${order.id} الخاص بمتجرك إلى ${order.status}.`;
  const companyMessage = `تم تحديث حالة الطلب رقم ${order.id} المسند إليك إلى ${order.status}.`;

  await Promise.allSettled([
    sendNotificationToUser(order.userId, buyerMessage, "تحديث حالة الطلب"),
    sendNotificationToUser(order.sellerId, sellerMessage, "تحديث حالة الطلب"),
    sendNotificationToUser(order.deliveryCompanyId, companyMessage, "تحديث حالة الطلب"),
  ]);
}

async function fetchOrderOr404(orderId, res) {
  const order = await Order.findByPk(orderId, {
    include: buildOrderInclude(),
  });

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return null;
  }

  return order;
}

router.get("/orders/admin/status", async (req, res) => {
  const status = String(req.query.status || "").trim();
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 40;
  const offset = (page - 1) * limit;

  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: "حالة الطلب غير صحيحة" });
  }

  try {
    const { rows: orders, count } = await Order.findAndCountAll({
      where: { status },
      order: [["createdAt", "DESC"]],
      offset,
      limit,
      include: buildOrderInclude(),
    });

    return res.status(200).json({
      orders: orders.map((order) => serializeOrder(order)).filter((order) => order.items.length > 0),
      paginationOrders: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching admin orders by status:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/agent/orders/status", async (req, res) => {
  const status = String(req.query.status || "").trim();
  const agentId = parseInt(req.query.agentId, 10);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 40;
  const offset = (page - 1) * limit;

  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: "حالة الطلب غير صحيحة" });
  }

  if (!agentId) {
    return res.status(400).json({ error: "agentId is required" });
  }

  try {
    const { rows: orders, count } = await Order.findAndCountAll({
      where: {
        status,
        sellerId: agentId,
      },
      order: [["createdAt", "DESC"]],
      offset,
      limit,
      include: buildOrderInclude(),
    });

    return res.status(200).json({
      orders: orders.map((order) => serializeOrder(order)).filter((order) => order.items.length > 0),
      paginationOrdersUser: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching agent orders by status:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/delivery-company/orders/status", async (req, res) => {
  const status = String(req.query.status || "").trim();
  const companyId = parseInt(req.query.companyId, 10);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 40;
  const offset = (page - 1) * limit;

  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: "حالة الطلب غير صحيحة" });
  }

  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    const { rows: orders, count } = await Order.findAndCountAll({
      where: {
        status,
        deliveryCompanyId: companyId,
      },
      order: [["createdAt", "DESC"]],
      offset,
      limit,
      include: buildOrderInclude(),
    });

    return res.status(200).json({
      orders: orders.map((order) => serializeOrder(order)).filter((order) => order.items.length > 0),
      paginationOrdersDeliveryCompany: {
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        totalItems: count,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching delivery company orders by status:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/orders/:userId", uploads.none(), async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const { phone, address, products } = req.body;
  const governorate = normalizeGovernorate(req.body.governorate);

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (!phone || !address || !governorate) {
    return res.status(400).json({
      error: "Phone, address, and governorate are required",
      allowedGovernorates: IRAQI_GOVERNORATES,
    });
  }

  if (!isValidIraqiGovernorate(governorate)) {
    return res.status(400).json({
      error: "Governorate must be one of the 19 Iraqi governorates",
      allowedGovernorates: IRAQI_GOVERNORATES,
    });
  }

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "يجب تمرير قائمة المنتجات مع الكميات" });
  }

  try {
    const buyer = await User.findByPk(userId, {
      attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
    });

    if (!buyer) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    for (const item of products) {
      if (typeof item.productId !== "number" || typeof item.quantity !== "number" || item.quantity <= 0) {
        return res.status(400).json({ error: "بيانات المنتجات غير صحيحة" });
      }
    }

    const productIds = products.map((item) => item.productId);
    const dbProducts = await Product.findAll({
      where: { id: productIds },
      include: [
        {
          model: User,
          as: "seller",
          attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
        },
      ],
    });

    if (dbProducts.length !== products.length) {
      return res.status(400).json({ error: "منتجات غير موجودة في النظام" });
    }

    const primarySeller = dbProducts[0]?.seller;
    if (!primarySeller || primarySeller.role !== "agent") {
      return res.status(400).json({ error: "لا يمكن إنشاء الطلب بدون تاجر صحيح" });
    }

    const hasDifferentSeller = dbProducts.some(
      (product) => !product.seller || product.seller.id !== primarySeller.id
    );

    if (hasDifferentSeller) {
      return res.status(400).json({
        error: "يجب أن تكون كل منتجات الطلب من نفس التاجر حتى يتم ربطها بشركة توصيل واحدة",
      });
    }

    const deliveryCompany = await getLeastBusyDeliveryCompany(primarySeller.location);
    if (!deliveryCompany) {
      return res.status(400).json({
        error: `لا توجد شركة توصيل مرتبطة بمحافظة التاجر ${primarySeller.location}`,
      });
    }

    let totalPrice = 0;
    for (const item of products) {
      const product = dbProducts.find((entry) => entry.id === item.productId);
      totalPrice += product.price * item.quantity;
    }

    const order = await Order.create({
      userId: buyer.id,
      sellerId: primarySeller.id,
      deliveryCompanyId: deliveryCompany.id,
      phone,
      address,
      governorate,
      totalPrice,
      status: "قيد الانتضار",
    });

    for (const item of products) {
      const product = dbProducts.find((entry) => entry.id === item.productId);
      await OrderItem.create({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        priceAtOrder: product.price,
      });
    }

    const fullOrder = await Order.findByPk(order.id, {
      include: buildOrderInclude(),
    });

    await sendOrderCreatedNotifications(fullOrder);

    const basket = await Basket.findOne({ where: { userId: buyer.id } });
    if (basket) {
      await BasketItem.destroy({ where: { basketId: basket.id } });
    }

    return res.status(201).json({
      message: "تم إنشاء الطلب بنجاح",
      order: serializeOrder(fullOrder),
    });
  } catch (error) {
    console.error("❌ Error creating order:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.patch("/orders/:orderId/status", uploads.none(), async (req, res) => {
  const orderId = parseInt(req.params.orderId, 10);
  const status = String(req.body.status || "").trim();

  if (!orderId) {
    return res.status(400).json({ error: "orderId is required" });
  }

  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: "حالة الطلب غير صحيحة" });
  }

  try {
    const order = await fetchOrderOr404(orderId, res);
    if (!order) {
      return;
    }

    order.status = status;
    await order.save();

    const refreshedOrder = await fetchOrderOr404(order.id, res);
    if (!refreshedOrder) {
      return;
    }

    await sendOrderStatusNotifications(refreshedOrder);

    return res.status(200).json({
      message: "تم تحديث حالة الطلب",
      order: serializeOrder(refreshedOrder),
    });
  } catch (error) {
    console.error("❌ Error updating order status:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/orders/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;

  if (!userId) {
    return res.status(400).json({ error: "يرجى تحديد معرف المستخدم userId" });
  }

  try {
    const { count, rows: orders } = await Order.findAndCountAll({
      where: { userId },
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      include: buildOrderInclude(),
    });

    return res.status(200).json({
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      orders: orders.map((order) => serializeOrder(order)).filter((order) => order.items.length > 0),
    });
  } catch (error) {
    console.error("❌ Error fetching orders:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/delivery-company/orders/:companyId", async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;

  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    const company = await User.findByPk(companyId, {
      attributes: ["id", "name", "phone", "location", "role", "isVerified", "image"],
    });

    if (!company || company.role !== "delivery_company") {
      return res.status(404).json({ error: "شركة التوصيل غير موجودة" });
    }

    const { count, rows: orders } = await Order.findAndCountAll({
      where: { deliveryCompanyId: company.id },
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      include: buildOrderInclude(),
    });

    return res.status(200).json({
      company,
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      orders: orders.map((order) => serializeOrder(order)).filter((order) => order.items.length > 0),
    });
  } catch (error) {
    console.error("❌ Error fetching delivery company orders:", error.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
