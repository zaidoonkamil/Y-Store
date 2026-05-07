const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { IRAQI_GOVERNORATES, normalizeGovernorate } = require("../constants/iraqiGovernorates");

const Order = sequelize.define("Order", {
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
  deliveryCompanyId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  address: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  governorate: {
    type: DataTypes.STRING,
    allowNull: false,
    set(value) {
      this.setDataValue("governorate", normalizeGovernorate(value));
    },
    validate: {
      isInGovernorates(value) {
        if (!IRAQI_GOVERNORATES.includes(normalizeGovernorate(value))) {
          throw new Error("Governorate must be one of the 19 Iraqi governorates");
        }
      },
    },
  },
  status: {
    type: DataTypes.ENUM("قيد الانتضار", "قيد التوصيل", "مكتمل", "ملغي"),
    allowNull: false,
    defaultValue: "قيد الانتضار",
  },
  totalPrice: {
    type: DataTypes.FLOAT,
    allowNull: false,
  }
}, {
  timestamps: true,
});

module.exports = Order;
