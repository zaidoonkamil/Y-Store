const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SellerRating = sequelize.define("SellerRating", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  sellerId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: 1,
      max: 5,
    },
  },
}, {
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ["userId", "sellerId"],
    },
  ],
});

module.exports = SellerRating;
