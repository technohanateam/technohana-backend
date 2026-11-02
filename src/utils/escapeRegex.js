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
  // Mongo rejects an empty $or, so there is no valid query to build without fields.
  if (!regex || !fields.length) {
    return null;
  }

  return {
    $or: fields.map((field) => ({ [field]: regex })),
  };
};
