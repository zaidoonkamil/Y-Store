const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const AgentSubscription = sequelize.define("AgentSubscription", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  agentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  packageType: {
    type: DataTypes.ENUM("monthly", "semiannual", "yearly"),
    allowNull: false,
  },
  startsAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  endsAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  approvedBy: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  requestId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  expiryReminderSentAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  timestamps: true,
});

module.exports = AgentSubscription;
