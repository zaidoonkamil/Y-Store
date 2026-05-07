const { DataTypes } = require("sequelize");
const sequelize = require("../config/db"); 

const Category = sequelize.define("Category", {
    id: { 
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true 
    },
    name: { 
        type: DataTypes.STRING,
        allowNull: false 
    },
    parentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
    },
    images: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: null,
    }
}, {
    timestamps: true,
});

module.exports = Category;
