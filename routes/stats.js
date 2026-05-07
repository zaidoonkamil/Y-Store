const express = require("express");
const { User, Order, Product } = require("../models");
const { Op } = require("sequelize");
const router = express.Router();

router.get("/stats", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startOfWeek = new Date();
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // ======= Users =======
    const [totalUsers, verifiedUsers, adminCount, agentCount, normalUsers,
      newTodayUsers, newWeekUsers, newMonthUsers] = await Promise.all([
      User.count(),
      User.count({ where: { isVerified: true } }),
      User.count({ where: { role: "admin" } }),
      User.count({ where: { role: "agent" } }),
      User.count({ where: { role: "user" } }),
      User.count({ where: { createdAt: { [Op.gte]: today } } }),
      User.count({ where: { createdAt: { [Op.gte]: startOfWeek } } }),
      User.count({ where: { createdAt: { [Op.gte]: startOfMonth } } }),
    ]);

    // ======= Orders =======
    const [totalOrders, todayOrders, weekOrders, monthOrders, ordersCompleted] = await Promise.all([
      Order.count(),
      Order.count({ where: { createdAt: { [Op.gte]: today } } }),
      Order.count({ where: { createdAt: { [Op.gte]: startOfWeek } } }),
      Order.count({ where: { createdAt: { [Op.gte]: startOfMonth } } }),
      Order.findAll({ where: { status: "مكتمل" }, attributes: ["totalPrice"] }),
    ]);

    const totalRevenue = ordersCompleted.reduce((sum, o) => sum + o.totalPrice, 0);

    const statusCounts = {};
    for (const status of ["قيد الانتضار", "قيد التوصيل", "مكتمل", "ملغي"]) {
      statusCounts[status] = await Order.count({ where: { status } });
    }

    // ======= Products =======
    const [totalProducts, newTodayProducts, newWeekProducts, newMonthProducts, productsByCategory, productsBySeller] = await Promise.all([
      Product.count(),
      Product.count({ where: { createdAt: { [Op.gte]: today } } }),
      Product.count({ where: { createdAt: { [Op.gte]: startOfWeek } } }),
      Product.count({ where: { createdAt: { [Op.gte]: startOfMonth } } }),
      Product.findAll({
        attributes: ["categoryId", [Product.sequelize.fn("COUNT", Product.sequelize.col("id")), "count"]],
        group: ["categoryId"],
      }),
      Product.findAll({
        attributes: ["userId", [Product.sequelize.fn("COUNT", Product.sequelize.col("id")), "count"]],
        group: ["userId"],
        order: [[Product.sequelize.literal("count"), "DESC"]],
        limit: 5,
      }),
    ]);

    res.json({
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        roles: { admin: adminCount, agent: agentCount, user: normalUsers },
        new: { today: newTodayUsers, thisWeek: newWeekUsers, thisMonth: newMonthUsers },
      },
      orders: {
        total: totalOrders,
        status: statusCounts,
        new: { today: todayOrders, thisWeek: weekOrders, thisMonth: monthOrders },
        revenue: { total: totalRevenue },
      },
      products: {
        total: totalProducts,
        new: { today: newTodayProducts, thisWeek: newWeekProducts, thisMonth: newMonthProducts },
        byCategory: productsByCategory,
        topSellers: productsBySeller,
      },
    });
  } catch (err) {
    console.error("❌ Error fetching stats:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
