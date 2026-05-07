const User = require("./user");
const UserDevice = require("./user_device");
const Category = require("./category");
const Product = require("./product");
const Favorite = require("./favorites");
const Basket = require("./Basket");
const BasketItem = require("./BasketItem");
const Order = require("./Order");
const OrderItem = require("./OrderItem");
const ChatMessage = require("./ChatMessage");
const AgentSubscriptionRequest = require("./AgentSubscriptionRequest");
const AgentSubscription = require("./AgentSubscription");
const SellerFollow = require("./SellerFollow");
const SellerRating = require("./SellerRating");

User.hasMany(Order, { foreignKey: "userId", as: "orders", onDelete: "CASCADE" });
Order.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
User.hasMany(Order, { foreignKey: "sellerId", as: "sellerOrders", onDelete: "CASCADE" });
Order.belongsTo(User, { foreignKey: "sellerId", as: "seller", onDelete: "CASCADE" });
User.hasMany(Order, { foreignKey: "deliveryCompanyId", as: "deliveryOrders", onDelete: "CASCADE" });
Order.belongsTo(User, { foreignKey: "deliveryCompanyId", as: "deliveryCompany", onDelete: "CASCADE" });

Order.hasMany(OrderItem, { foreignKey: "orderId", onDelete: "CASCADE" });
OrderItem.belongsTo(Order, { foreignKey: "orderId" });

Product.hasMany(OrderItem, { foreignKey: "productId", onDelete: "CASCADE" });
OrderItem.belongsTo(Product, { foreignKey: "productId" });

User.hasOne(Basket, { foreignKey: "userId", onDelete: "CASCADE" });
Basket.belongsTo(User, { foreignKey: "userId" });

Basket.hasMany(BasketItem, { foreignKey: "basketId", onDelete: "CASCADE" });
BasketItem.belongsTo(Basket, { foreignKey: "basketId" });

Product.hasMany(BasketItem, { foreignKey: "productId", onDelete: "CASCADE" });
BasketItem.belongsTo(Product, { foreignKey: "productId" });

User.hasMany(UserDevice, { foreignKey: 'user_id', as: 'devices', onDelete: 'CASCADE' });
UserDevice.belongsTo(User, { foreignKey: 'user_id', as: 'user', onDelete: 'CASCADE' });

Product.belongsTo(User, { foreignKey: "userId", as: "seller", onDelete: 'CASCADE' });
User.hasMany(Product, { foreignKey: "userId", as: "products" , onDelete: 'CASCADE'});

User.belongsToMany(Product, { through: Favorite, foreignKey: "userId", as: "favoriteProducts" , onDelete: 'CASCADE' });
Product.belongsToMany(User, { through: Favorite, foreignKey: "productId", as: "favoritedByUsers", onDelete: 'CASCADE' });

ChatMessage.belongsTo(User, { as: "sender", foreignKey: "senderId" , onDelete: 'CASCADE'});
ChatMessage.belongsTo(User, { as: "receiver", foreignKey: "receiverId" , onDelete: 'CASCADE' });

User.hasMany(ChatMessage, { as: "sentMessages", foreignKey: "senderId" , onDelete: 'CASCADE' });
User.hasMany(ChatMessage, { as: "receivedMessages", foreignKey: "receiverId" , onDelete: 'CASCADE'});

Category.hasMany(Product, { foreignKey: "categoryId", as: "products", onDelete: "CASCADE" });
Product.belongsTo(Category, { foreignKey: "categoryId", as: "category", onDelete: "CASCADE" });
Category.hasMany(Category, { foreignKey: "parentId", as: "subcategories", onDelete: "CASCADE" });
Category.belongsTo(Category, { foreignKey: "parentId", as: "parent", onDelete: "CASCADE" });

Favorite.belongsTo(Product, { foreignKey: "productId", as: "product", onDelete: "CASCADE" });
Product.hasMany(Favorite, { foreignKey: "productId", as: "favorites", onDelete: "CASCADE" });

User.hasMany(AgentSubscriptionRequest, { foreignKey: "agentId", as: "subscriptionRequests", onDelete: "CASCADE" });
AgentSubscriptionRequest.belongsTo(User, { foreignKey: "agentId", as: "agent", onDelete: "CASCADE" });

User.hasMany(AgentSubscription, { foreignKey: "agentId", as: "subscriptions", onDelete: "CASCADE" });
AgentSubscription.belongsTo(User, { foreignKey: "agentId", as: "agent", onDelete: "CASCADE" });

User.belongsToMany(User, {
  through: SellerFollow,
  foreignKey: "userId",
  otherKey: "sellerId",
  as: "followedSellers",
  onDelete: "CASCADE",
});
User.belongsToMany(User, {
  through: SellerFollow,
  foreignKey: "sellerId",
  otherKey: "userId",
  as: "followers",
  onDelete: "CASCADE",
});
SellerFollow.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
SellerFollow.belongsTo(User, { foreignKey: "sellerId", as: "seller", onDelete: "CASCADE" });

User.hasMany(SellerRating, { foreignKey: "userId", as: "givenSellerRatings", onDelete: "CASCADE" });
User.hasMany(SellerRating, { foreignKey: "sellerId", as: "receivedSellerRatings", onDelete: "CASCADE" });
SellerRating.belongsTo(User, { foreignKey: "userId", as: "user", onDelete: "CASCADE" });
SellerRating.belongsTo(User, { foreignKey: "sellerId", as: "seller", onDelete: "CASCADE" });

module.exports = {
  User,
  UserDevice,
  Category,
  Product,
  Favorite,
  Basket,
  BasketItem,
  Order,
  OrderItem,
  ChatMessage,
  AgentSubscriptionRequest,
  AgentSubscription,
  SellerFollow,
  SellerRating,
};
