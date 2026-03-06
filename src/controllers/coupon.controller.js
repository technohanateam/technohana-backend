import Coupon from "../models/coupon.model.js"

// Get all coupons with optional search and filtering
export const getAllCoupons = async (req, res) => {
  try {
    const { search, isActive, page = 1, limit = 10 } = req.query
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    // Build filter
    const filter = {}
    if (search) {
      filter.$or = [
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ]
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true'
    }

    const total = await Coupon.countDocuments(filter)
    const coupons = await Coupon.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()

    return res.json({
      success: true,
      data: coupons,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    console.error('Error fetching coupons:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching coupons'
    })
  }
}

// Get single coupon by ID
export const getCoupon = async (req, res) => {
  try {
    const { id } = req.params
    const coupon = await Coupon.findById(id)

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      })
    }

    return res.json({
      success: true,
      data: coupon
    })
  } catch (error) {
    console.error('Error fetching coupon:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching coupon'
    })
  }
}

// Create new coupon
export const createCoupon = async (req, res) => {
  try {
    const { code, discountPercent, description, validCurrencies, isActive, expiryDate, maxUsageCount, notes } = req.body

    // Validate required fields
    if (!code || discountPercent === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Code and discount percent are required'
      })
    }

    // Validate discount percent
    if (discountPercent < 0 || discountPercent > 100) {
      return res.status(400).json({
        success: false,
        message: 'Discount percent must be between 0 and 100'
      })
    }

    // Check if code already exists
    const existing = await Coupon.findOne({ code: code.toUpperCase() })
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      })
    }

    const coupon = new Coupon({
      code: code.toUpperCase(),
      discountPercent,
      description: description || null,
      validCurrencies: validCurrencies && validCurrencies.length > 0 ? validCurrencies : null,
      isActive: isActive !== false,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      maxUsageCount: maxUsageCount || null,
      notes: notes || null
    })

    await coupon.save()

    return res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      data: coupon
    })
  } catch (error) {
    console.error('Error creating coupon:', error)
    return res.status(500).json({
      success: false,
      message: 'Error creating coupon'
    })
  }
}

// Update coupon
export const updateCoupon = async (req, res) => {
  try {
    const { id } = req.params
    const { code, discountPercent, description, validCurrencies, isActive, expiryDate, maxUsageCount, notes } = req.body

    const coupon = await Coupon.findById(id)
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      })
    }

    // Check if new code conflicts with existing coupon
    if (code && code.toUpperCase() !== coupon.code) {
      const existing = await Coupon.findOne({ code: code.toUpperCase() })
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Coupon code already exists'
        })
      }
      coupon.code = code.toUpperCase()
    }

    if (discountPercent !== undefined) {
      if (discountPercent < 0 || discountPercent > 100) {
        return res.status(400).json({
          success: false,
          message: 'Discount percent must be between 0 and 100'
        })
      }
      coupon.discountPercent = discountPercent
    }

    if (description !== undefined) coupon.description = description || null
    if (validCurrencies !== undefined) coupon.validCurrencies = validCurrencies && validCurrencies.length > 0 ? validCurrencies : null
    if (isActive !== undefined) coupon.isActive = isActive
    if (expiryDate !== undefined) coupon.expiryDate = expiryDate ? new Date(expiryDate) : null
    if (maxUsageCount !== undefined) coupon.maxUsageCount = maxUsageCount || null
    if (notes !== undefined) coupon.notes = notes || null

    // Don't allow changing usage count (only resets by admin action)
    // currentUsageCount is read-only from the API perspective

    await coupon.save()

    return res.json({
      success: true,
      message: 'Coupon updated successfully',
      data: coupon
    })
  } catch (error) {
    console.error('Error updating coupon:', error)
    return res.status(500).json({
      success: false,
      message: 'Error updating coupon'
    })
  }
}

// Delete coupon
export const deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params

    const coupon = await Coupon.findByIdAndDelete(id)
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      })
    }

    return res.json({
      success: true,
      message: 'Coupon deleted successfully',
      data: coupon
    })
  } catch (error) {
    console.error('Error deleting coupon:', error)
    return res.status(500).json({
      success: false,
      message: 'Error deleting coupon'
    })
  }
}

// Reset usage count for a coupon
export const resetCouponUsage = async (req, res) => {
  try {
    const { id } = req.params

    const coupon = await Coupon.findById(id)
    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      })
    }

    coupon.currentUsageCount = 0
    await coupon.save()

    return res.json({
      success: true,
      message: 'Usage count reset successfully',
      data: coupon
    })
  } catch (error) {
    console.error('Error resetting usage count:', error)
    return res.status(500).json({
      success: false,
      message: 'Error resetting usage count'
    })
  }
}

// Validate coupon (public endpoint used during enrollment)
export const validateCoupon = async (req, res) => {
  try {
    const { code, currency } = req.body

    if (!code) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: 'Coupon code is required'
      })
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase() })

    if (!coupon) {
      return res.json({
        success: false,
        valid: false,
        error: 'Invalid coupon code'
      })
    }

    // Check if coupon is active
    if (!coupon.isActive) {
      return res.json({
        success: false,
        valid: false,
        error: 'This coupon is no longer active'
      })
    }

    // Check if coupon is expired
    if (coupon.isExpired()) {
      return res.json({
        success: false,
        valid: false,
        error: 'This coupon has expired'
      })
    }

    // Check if coupon has reached usage limit
    if (coupon.isExhausted()) {
      return res.json({
        success: false,
        valid: false,
        error: 'This coupon has reached its usage limit'
      })
    }

    // Check if coupon is valid for the currency
    if (!coupon.isValidForCurrency(currency)) {
      return res.json({
        success: false,
        valid: false,
        error: 'Coupon not valid for your region'
      })
    }

    return res.json({
      success: true,
      valid: true,
      discountPercent: coupon.discountPercent
    })
  } catch (error) {
    console.error('Error validating coupon:', error)
    return res.status(500).json({
      success: false,
      valid: false,
      error: 'Error validating coupon'
    })
  }
}

// Increment usage count when coupon is applied (called from enrollment success)
export const incrementCouponUsage = async (couponCode) => {
  try {
    if (!couponCode) return

    await Coupon.updateOne(
      { code: couponCode.toUpperCase() },
      { $inc: { currentUsageCount: 1 } }
    )
  } catch (error) {
    console.error('Error incrementing coupon usage:', error)
    // Don't throw error - usage tracking is non-critical
  }
}

// Get coupon stats (for dashboard)
export const getCouponStats = async (req, res) => {
  try {
    const total = await Coupon.countDocuments()
    const active = await Coupon.countDocuments({ isActive: true })
    const expired = await Coupon.countDocuments({
      expiryDate: { $lt: new Date() },
      isActive: true
    })

    const topCoupons = await Coupon.find()
      .sort({ currentUsageCount: -1 })
      .limit(5)
      .lean()

    return res.json({
      success: true,
      stats: {
        total,
        active,
        expired,
        topCoupons
      }
    })
  } catch (error) {
    console.error('Error fetching coupon stats:', error)
    return res.status(500).json({
      success: false,
      message: 'Error fetching coupon stats'
    })
  }
}
