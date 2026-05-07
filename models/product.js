const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Product = sequelize.define("Product", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    price: {
        type: DataTypes.FLOAT,
        allowNull: false,
    },
    discountType: {
        type: DataTypes.ENUM("none", "percentage", "fixed"),
        allowNull: false,
        defaultValue: "none",
    },
    discountValue: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: null,
    },
    images: {
        type: DataTypes.JSON,
        allowNull: false,
    }
}, {
    timestamps: true,
});


module.exports = Product;
