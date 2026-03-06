import mongoose, { Schema } from "mongoose"

const couponSchema = new Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  discountPercent: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  description: {
    type: String,
    trim: true
  },
  // null = valid globally, array = valid only for these currencies
  validCurrencies: {
    type: [String],
    default: null,
    lowercase: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  expiryDate: {
    type: Date,
    default: null // null = no expiry
  },
  maxUsageCount: {
    type: Number,
    default: null // null = unlimited
  },
  currentUsageCount: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
})

// Update the updatedAt timestamp on save
couponSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
})

// Check if coupon is expired
couponSchema.methods.isExpired = function () {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
}

// Check if coupon has exceeded usage limit
couponSchema.methods.isExhausted = function () {
  if (!this.maxUsageCount) return false;
  return this.currentUsageCount >= this.maxUsageCount;
}

// Check if coupon is valid for a specific currency
couponSchema.methods.isValidForCurrency = function (currency) {
  if (!this.validCurrencies || this.validCurrencies.length === 0) {
    return true; // Global coupon
  }
  return this.validCurrencies.includes(currency?.toLowerCase());
}

const Coupon = mongoose.model('Coupon', couponSchema)
export default Coupon
