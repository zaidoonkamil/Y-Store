const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { IRAQI_GOVERNORATES, normalizeGovernorate } = require("../constants/iraqiGovernorates");
const { WHOLESALE_LOCATIONS, normalizeWholesaleLocation } = require("../constants/wholesaleLocations");

const User = sequelize.define("User", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    image: {
        type: DataTypes.JSON,
        allowNull: true, 
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    companyName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    brandName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    location: {
        type: DataTypes.STRING,
        allowNull: false,
        set(value) {
            const normalizer = this.role === "wholesale_seller" ? normalizeWholesaleLocation : normalizeGovernorate;
            this.setDataValue("location", normalizer(value));
        },
        validate: {
            isInGovernorates(value) {
                if (this.role === "wholesale_seller") {
                    if (!WHOLESALE_LOCATIONS.includes(normalizeWholesaleLocation(value))) {
                        throw new Error("Wholesale seller location must be one of: Baghdad, Erbil, Turkey");
                    }
                    return;
                }

                if (!IRAQI_GOVERNORATES.includes(normalizeGovernorate(value))) {
                    throw new Error("Location must be one of the 19 Iraqi governorates");
                }
            },
        },
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    role: {
        type: DataTypes.ENUM("user", "admin", "agent", "delivery_company", "wholesale_seller"), 
        allowNull: false,
        defaultValue: "user",
    },
    isVerified: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    storeActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    isFeaturedSeller: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    additionalVerificationType: {
        type: DataTypes.ENUM("none", "six_months", "yearly"),
        allowNull: false,
        defaultValue: "none",
    },
    additionalVerificationStartDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    additionalVerificationEndDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    additionalVerificationReminderSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
}, {
    timestamps: true,
});


module.exports = User;
