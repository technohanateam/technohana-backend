import Proposal from '../models/proposal.model.js';
import { computeQuote, applyManualDiscount } from '../utils/pricing.js';

const generateRefNum = () =>
  `TH-${new Date().getFullYear()}-${String(Math.floor(10000 + Math.random() * 90000))}`;

async function resolveRefNum(provided) {
  if (provided && typeof provided === 'string' && provided.trim()) {
    const exists = await Proposal.exists({ refNum: provided.trim() });
    if (!exists) return provided.trim();
  }
  for (let i = 0; i < 10; i++) {
    const candidate = generateRefNum();
    const exists = await Proposal.exists({ refNum: candidate });
    if (!exists) return candidate;
  }
  throw new Error('Could not generate unique ref number');
}

function computeLine({ courseId, seats, currency, manualDiscountPercent }) {
  const participants = Math.max(1, Number(seats) || 1);
  const enrollmentType = participants >= 2 ? 'group' : 'individual';
  const baseQuote = computeQuote({ courseId, enrollmentType, participants, currency });
  return applyManualDiscount(baseQuote, manualDiscountPercent || 0);
}

export const quoteProposalLine = async (req, res) => {
  try {
    const { courseId, seats, currency, manualDiscountPercent } = req.body;
    if (!courseId || !currency) {
      return res.status(400).json({ success: false, message: 'courseId and currency are required' });
    }
    const quote = computeLine({ courseId, seats, currency, manualDiscountPercent });
    return res.json({ success: true, data: quote });
  } catch (err) {
    console.error('quoteProposalLine error:', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to compute quote' });
  }
};

export const createProposal = async (req, res) => {
  try {
    const { client, validUntil, notes, status, courses, refNum: providedRef } = req.body;

    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one course is required' });
    }

    const computedCourses = courses.map((c) => {
      const quote = computeLine(c);
      return {
        courseId: c.courseId,
        courseTitle: c.courseTitle || '',
        seats: Math.max(1, Number(c.seats) || 1),
        currency: c.currency,
        manualDiscountPercent: quote.manualDiscountPercent || 0,
        quote,
      };
    });

    const firstCurrency = computedCourses[0].currency.toUpperCase();
    const grandTotalMinor = computedCourses.reduce((s, c) => s + (c.quote.expectedTotalMinor || 0), 0);
    const originalTotalMinor = computedCourses.reduce(
      (s, c) => s + (c.quote.originalUnitMinor || 0) * c.seats, 0
    );

    const hasManualDiscount = computedCourses.some((c) => c.manualDiscountPercent > 0);
    const refNum = await resolveRefNum(providedRef);

    const proposal = new Proposal({
      refNum,
      client: client || {},
      validUntil: validUntil ? new Date(validUntil) : null,
      notes: notes || '',
      courses: computedCourses,
      totals: { grandTotalMinor, originalTotalMinor, currency: firstCurrency },
      status: status || 'draft',
      createdBy: req.admin?.email || null,
      manualDiscountAppliedBy: hasManualDiscount ? req.admin?.email || null : null,
    });

    await proposal.save();
    return res.status(201).json({ success: true, data: proposal, message: 'Proposal saved' });
  } catch (err) {
    console.error('createProposal error:', err);
    return res.status(500).json({ success: false, message: 'Error saving proposal' });
  }
};

export const updateProposal = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await Proposal.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Proposal not found' });
    }

    const { client, validUntil, notes, status, courses } = req.body;

    if (courses && Array.isArray(courses) && courses.length > 0) {
      const computedCourses = courses.map((c) => {
        const quote = computeLine(c);
        return {
          courseId: c.courseId,
          courseTitle: c.courseTitle || '',
          seats: Math.max(1, Number(c.seats) || 1),
          currency: c.currency,
          manualDiscountPercent: quote.manualDiscountPercent || 0,
          quote,
        };
      });

      const firstCurrency = computedCourses[0].currency.toUpperCase();
      const grandTotalMinor = computedCourses.reduce((s, c) => s + (c.quote.expectedTotalMinor || 0), 0);
      const originalTotalMinor = computedCourses.reduce(
        (s, c) => s + (c.quote.originalUnitMinor || 0) * c.seats, 0
      );
      const hasManualDiscount = computedCourses.some((c) => c.manualDiscountPercent > 0);

      existing.courses = computedCourses;
      existing.totals = { grandTotalMinor, originalTotalMinor, currency: firstCurrency };
      existing.manualDiscountAppliedBy = hasManualDiscount
        ? req.admin?.email || existing.manualDiscountAppliedBy
        : null;
    }

    if (client !== undefined) existing.client = client;
    if (validUntil !== undefined) existing.validUntil = validUntil ? new Date(validUntil) : null;
    if (notes !== undefined) existing.notes = notes;
    if (status !== undefined) existing.status = status;

    await existing.save();
    return res.json({ success: true, data: existing, message: 'Proposal updated' });
  } catch (err) {
    console.error('updateProposal error:', err);
    return res.status(500).json({ success: false, message: 'Error updating proposal' });
  }
};

export const getProposals = async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};
    if (search) {
      filter.$or = [
        { refNum: { $regex: search, $options: 'i' } },
        { 'client.name': { $regex: search, $options: 'i' } },
        { 'client.company': { $regex: search, $options: 'i' } },
        { 'client.email': { $regex: search, $options: 'i' } },
      ];
    }
    if (status) filter.status = status;

    const total = await Proposal.countDocuments(filter);
    const proposals = await Proposal.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    return res.json({
      success: true,
      data: proposals,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error('getProposals error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching proposals' });
  }
};

export const getProposal = async (req, res) => {
  try {
    const proposal = await Proposal.findById(req.params.id).lean();
    if (!proposal) {
      return res.status(404).json({ success: false, message: 'Proposal not found' });
    }
    return res.json({ success: true, data: proposal });
  } catch (err) {
    console.error('getProposal error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching proposal' });
  }
};

export const deleteProposal = async (req, res) => {
  try {
    const proposal = await Proposal.findByIdAndDelete(req.params.id);
    if (!proposal) {
      return res.status(404).json({ success: false, message: 'Proposal not found' });
    }
    return res.json({ success: true, message: 'Proposal deleted', data: proposal });
  } catch (err) {
    console.error('deleteProposal error:', err);
    return res.status(500).json({ success: false, message: 'Error deleting proposal' });
  }
};
