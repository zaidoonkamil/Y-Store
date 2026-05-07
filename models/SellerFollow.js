const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const SellerFollow = sequelize.define("SellerFollow", {
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
}, {
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ["userId", "sellerId"],
    },
  ],
});

module.exports = SellerFollow;
