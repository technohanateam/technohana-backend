import crypto from 'crypto';

const CONFIRM_SECRET = process.env.CONFIRM_DELETE_SECRET || 'confirm-delete-secret';

export const generateDeleteConfirmationToken = (resourceId) => {
  return crypto
    .createHmac('sha256', CONFIRM_SECRET)
    .update(String(resourceId))
    .digest('hex');
};

export const requireDeleteConfirmation = (resourceId, providedToken) => {
  const expectedToken = generateDeleteConfirmationToken(resourceId);
  return crypto.timingSafeEqual(
    Buffer.from(expectedToken),
    Buffer.from(providedToken || '')
  ).valueOf();
};

export const confirmDeleteMiddleware = (req, res, next) => {
  const resourceId = req.params.id || req.body.id;
  const confirmToken = req.headers['x-confirm-delete'] || req.query.confirmDelete;

  if (!resourceId) {
    return res.status(400).json({ success: false, message: 'Resource ID required' });
  }

  if (!confirmToken) {
    const token = generateDeleteConfirmationToken(resourceId);
    return res.status(409).json({
      success: false,
      message: 'Delete confirmation required',
      confirmationToken: token,
      instruction: 'Include this token in the X-Confirm-Delete header to confirm deletion'
    });
  }

  try {
    const isValid = requireDeleteConfirmation(resourceId, confirmToken);
    if (!isValid) {
      return res.status(403).json({ success: false, message: 'Invalid confirmation token' });
    }
    next();
  } catch {
    return res.status(403).json({ success: false, message: 'Invalid confirmation token' });
  }
};
