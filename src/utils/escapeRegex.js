const escapeSpecialChars = (str) => {
  if (!str || typeof str !== 'string') {
    return '';
  }
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

export const buildRegexQuery = (searchTerm) => {
  if (!searchTerm || typeof searchTerm !== 'string') {
    return null;
  }

  const trimmed = searchTerm.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const escaped = escapeSpecialChars(trimmed);
  return new RegExp(escaped, 'i');
};

export const buildMultiFieldRegexQuery = (searchTerm, fields = []) => {
  const regex = buildRegexQuery(searchTerm);
  if (!regex) {
    return null;
  }

  return {
    $or: fields.map((field) => ({ [field]: regex })),
  };
};
