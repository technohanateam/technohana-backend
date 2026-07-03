import { buildRegexQuery, buildMultiFieldRegexQuery } from '../../src/utils/escapeRegex.js';

describe('Security: NoSQL Injection Prevention', () => {
  test('Escaped regex should handle special regex characters', () => {
    const dangerousInput = '.*';
    const regex = buildRegexQuery(dangerousInput);
    expect(regex.source).toBe('\\.\\ *');
  });

  test('Escaped regex should handle all special regex characters', () => {
    const specialChars = '.*+?^${}()|[]\\';
    const regex = buildRegexQuery(specialChars);

    for (const char of specialChars) {
      expect(regex.source).toContain('\\');
    }
  });

  test('ReDoS attack patterns should be escaped', () => {
    const redosPattern = '(a+)+b';
    const regex = buildRegexQuery(redosPattern);
    expect(regex.source).toBe('\\(a\\+\\)\\+b');
  });

  test('Null/undefined/empty searches should return null', () => {
    expect(buildRegexQuery(null)).toBeNull();
    expect(buildRegexQuery(undefined)).toBeNull();
    expect(buildRegexQuery('')).toBeNull();
    expect(buildRegexQuery('   ')).toBeNull();
  });

  test('Non-string input should be handled safely', () => {
    expect(buildRegexQuery(123)).toBeNull();
    expect(buildRegexQuery({})).toBeNull();
    expect(buildRegexQuery([])).toBeNull();
  });

  test('Multi-field regex query should be escaped', () => {
    const searchTerm = 'test.*injection';
    const query = buildMultiFieldRegexQuery(searchTerm, ['name', 'email']);

    expect(query).toBeDefined();
    expect(query.$or).toBeDefined();
    expect(query.$or.length).toBe(2);

    const expectedSource = 'test\\.\\*injection';
    query.$or.forEach((condition) => {
      const fieldValue = Object.values(condition)[0];
      expect(fieldValue.source).toBe(expectedSource);
    });
  });

  test('Empty field array should return null', () => {
    expect(buildMultiFieldRegexQuery('test', [])).toBeNull();
  });

  test('Normal search terms should still work', () => {
    const regex = buildRegexQuery('john');
    expect(regex.source).toBe('john');

    const multiFieldQuery = buildMultiFieldRegexQuery('john', ['name', 'email']);
    expect(multiFieldQuery.$or.length).toBe(2);
  });

  test('Case-insensitive flag should always be set', () => {
    const regex = buildRegexQuery('Test');
    expect(regex.flags).toContain('i');
  });
});
