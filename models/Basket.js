const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Basket = sequelize.define("Basket", {
  id: { 
    type: DataTypes.INTEGER, 
    autoIncrement: true,
     primaryKey: true
     },
  userId: { 
    type: DataTypes.INTEGER,
     allowNull: false 
    },
}, {
  timestamps: true,
});

module.exports = Basket;