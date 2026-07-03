import { validateEmail, validatePhone, validateName, validateEnrollmentForm, sanitizeString } from '../../src/utils/inputValidator.js';

describe('Security: Input Validation', () => {
  describe('Email validation', () => {
    test('Valid emails should pass', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('test+tag@domain.co.uk')).toBe(true);
    });

    test('Invalid emails should fail', () => {
      expect(validateEmail('invalid')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('@domain.com')).toBe(false);
      expect(validateEmail('')).toBe(false);
      expect(validateEmail(null)).toBe(false);
    });
  });

  describe('Phone validation', () => {
    test('Valid phone numbers should pass', () => {
      expect(validatePhone('9876543210')).toBe(true);
      expect(validatePhone('+1-555-555-5555')).toBe(true);
      expect(validatePhone('(555) 555-5555')).toBe(true);
    });

    test('Invalid phone numbers should fail', () => {
      expect(validatePhone('12345')).toBe(false);
      expect(validatePhone('abc')).toBe(false);
      expect(validatePhone('')).toBe(false);
    });
  });

  describe('Name validation', () => {
    test('Valid names should pass', () => {
      expect(validateName('John Doe')).toBe(true);
      expect(validateName('Jane Smith')).toBe(true);
    });

    test('Invalid names should fail', () => {
      expect(validateName('a')).toBe(false);
      expect(validateName('John<script>alert("xss")</script>')).toBe(false);
      expect(validateName('')).toBe(false);
    });
  });

  describe('XSS prevention', () => {
    test('Dangerous characters should be removed', () => {
      expect(sanitizeString('Hello<script>alert("xss")</script>')).toBe('Helloscriptalertxssscript');
      expect(sanitizeString('Test"injection')).toBe('Testinjection');
      expect(sanitizeString("Bob's<div>Hack</div>")).toBe('BobsdiHackdiv');
    });
  });

  describe('Enrollment form validation', () => {
    test('Valid form data should pass', () => {
      const data = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '9876543210',
        courseTitle: 'Test Course',
        company: 'Test Corp',
        specialRequest: '',
        trainingLocation: 'Online',
        price: 1000,
        currency: 'INR',
        trainingType: 'individual',
      };
      const result = validateEnrollmentForm(data);
      expect(result.isValid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    test('Missing required fields should fail', () => {
      const data = {
        name: '',
        email: 'john@example.com',
        phone: '9876543210',
        courseTitle: 'Test Course',
      };
      const result = validateEnrollmentForm(data);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('Invalid email should fail', () => {
      const data = {
        name: 'John Doe',
        email: 'invalid-email',
        phone: '9876543210',
        courseTitle: 'Test Course',
      };
      const result = validateEnrollmentForm(data);
      expect(result.isValid).toBe(false);
    });

    test('Invalid phone should fail', () => {
      const data = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '123',
        courseTitle: 'Test Course',
      };
      const result = validateEnrollmentForm(data);
      expect(result.isValid).toBe(false);
    });
  });
});
