const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const OtpCode = sequelize.define("OtpCode", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  purpose: {
    type: DataTypes.ENUM("verify_account", "reset_password"),
    allowNull: false,
    defaultValue: "verify_account",
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  isUsed: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  expiryDate: {
    type: DataTypes.DATE,
    allowNull: false,
  },
}, {
  timestamps: true,
});

module.exports = OtpCode;
