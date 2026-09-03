import Lead from "../models/lead.model.js"

// Get all leads with optional persona filter and pagination
export const getAllLeads = async (req, res) => {
  try {
    const { page = 1, limit = 20, persona } = req.query
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const filter = persona ? { persona } : {}

    const total = await Lead.countDocuments(filter)
    const data = await Lead.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()

    return res.json({ success: true, data, total, page: pageNum, limit: limitNum })
  } catch (error) {
    console.error('Error fetching leads:', error)
    return res.status(500).json({ success: false, message: 'Error fetching leads' })
  }
}

// Get single lead by ID
export const getLead = async (req, res) => {
  try {
    const { id } = req.params
    const lead = await Lead.findById(id)

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' })
    }

    return res.json({ success: true, data: lead })
  } catch (error) {
    console.error('Error fetching lead:', error)
    return res.status(500).json({ success: false, message: 'Error fetching lead' })
  }
}

// Create new lead
export const createLead = async (req, res) => {
  try {
    const { name, email, persona, phone, jobTitle, source, utm } = req.body

    if (!name || !email || !persona) {
      return res.status(400).json({ success: false, message: 'Name, email, and persona are required' })
    }

    const lead = new Lead({
      name,
      email,
      persona,
      phone: phone || undefined,
      jobTitle: jobTitle || undefined,
      source: source || 'admin',
      utm: utm || {},
    })

    await lead.save()

    return res.status(201).json({ success: true, message: 'Lead created successfully', data: lead })
  } catch (error) {
    console.error('Error creating lead:', error)
    return res.status(500).json({ success: false, message: 'Error creating lead' })
  }
}

// Update lead
export const updateLead = async (req, res) => {
  try {
    const { id } = req.params
    const { name, email, persona, phone, jobTitle, source } = req.body

    const lead = await Lead.findById(id)
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' })
    }

    if (name !== undefined) lead.name = name
    if (email !== undefined) lead.email = email
    if (persona !== undefined) lead.persona = persona
    if (phone !== undefined) lead.phone = phone
    if (jobTitle !== undefined) lead.jobTitle = jobTitle
    if (source !== undefined) lead.source = source

    await lead.save()

    return res.json({ success: true, message: 'Lead updated successfully', data: lead })
  } catch (error) {
    console.error('Error updating lead:', error)
    return res.status(500).json({ success: false, message: 'Error updating lead' })
  }
}

// Delete lead
export const deleteLead = async (req, res) => {
  try {
    const { id } = req.params

    const lead = await Lead.findByIdAndDelete(id)
    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' })
    }

    return res.json({ success: true, message: 'Lead deleted successfully', data: lead })
  } catch (error) {
    console.error('Error deleting lead:', error)
    return res.status(500).json({ success: false, message: 'Error deleting lead' })
  }
}
