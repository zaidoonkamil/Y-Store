const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AgentSubscriptionRequest = sequelize.define("AgentSubscriptionRequest", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  agentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  requestedPackage: {
    type: DataTypes.ENUM("monthly", "semiannual", "yearly"),
    allowNull: false,
  },
  approvedPackage: {
    type: DataTypes.ENUM("monthly", "semiannual", "yearly"),
    allowNull: true,
  },
  transferReceiptImage: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM("pending", "approved", "rejected"),
    allowNull: false,
    defaultValue: "pending",
  },
  adminNote: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  reviewedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  timestamps: true,
});

module.exports = AgentSubscriptionRequest;
