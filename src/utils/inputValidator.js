const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+\-\s()]{10,}$/;
const XSS_CHARS_REGEX = /[<>\"'`]/g;

export const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim()) && email.length <= 254;
};

export const validatePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return false;
  return PHONE_REGEX.test(phone.trim());
};

export const validateName = (name) => {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 100 && !XSS_CHARS_REGEX.test(trimmed);
};

export const validateString = (str, minLength = 1, maxLength = 500) => {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  return trimmed.length >= minLength && trimmed.length <= maxLength;
};

export const sanitizeString = (str) => {
  if (typeof str !== 'string') return '';
  return str.trim().replace(XSS_CHARS_REGEX, '');
};

export const validateEnrollmentForm = (data) => {
  const errors = [];

  if (!validateName(data.name)) {
    errors.push('Invalid name (2-100 characters, no special characters)');
  }

  if (!validateEmail(data.email)) {
    errors.push('Invalid email format');
  }

  if (!validatePhone(data.phone)) {
    errors.push('Invalid phone number (at least 10 digits)');
  }

  if (!validateString(data.courseTitle, 2, 200)) {
    errors.push('Invalid course title');
  }

  if (data.company && !validateString(data.company, 1, 200)) {
    errors.push('Invalid company name');
  }

  if (data.specialRequest && !validateString(data.specialRequest, 0, 1000)) {
    errors.push('Special request too long (max 1000 characters)');
  }

  if (data.trainingLocation && !validateString(data.trainingLocation, 1, 200)) {
    errors.push('Invalid training location');
  }

  if (data.price && typeof data.price !== 'number' && !validateString(String(data.price), 0, 50)) {
    errors.push('Invalid price');
  }

  if (data.currency && !validateString(data.currency, 2, 5)) {
    errors.push('Invalid currency');
  }

  if (data.trainingType && !['individual', 'group'].includes(data.trainingType)) {
    errors.push('Invalid training type');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};
