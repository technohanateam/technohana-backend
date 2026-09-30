import express from 'express';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import upload from '../middleware/upload.js';
import { enrollUser, getUsersByStatus, getMyEnrollments, updateEnrollmentProgress, issueCertificate, updateEnrollment, deleteEnrollment, submitInstructorReview, getInstructorReviewForEnrollment } from '../controllers/enrollment.controller.js';
import { InstructorForm } from '../controllers/instructorForm.controller.js';
import { submitInternApplication } from '../controllers/internApplication.controller.js';
import { authenticateJWT } from '../middleware/authenticateJWT.js';
import { verifyCaptcha } from '../utils/verifyCaptcha.js';

const router = express.Router();

// Public, unauthenticated, and each submission stores a record, uploads a resume and sends emails.
const applicationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many applications from this network. Please try again in a few minutes.' },
});

const discardUpload = (req) => {
  if (req.file?.path) fs.unlink(req.file.path, () => {});
};

// Runs after multer (the token travels in the multipart body).
const requireCaptcha = (routeName) => async (req, res, next) => {
  if (!process.env.TURNSTILE_SECRET_KEY && process.env.NODE_ENV === 'production') {
    console.error(`[${routeName}] TURNSTILE_SECRET_KEY is not set; rejecting applications until it is configured.`);
    discardUpload(req);
    return res.status(503).json({ success: false, message: 'Applications are temporarily unavailable. Please email careers@technohana.in with your resume.' });
  }
  if (!(await verifyCaptcha(req.body?.captchaToken, req.ip))) {
    discardUpload(req);
    return res.status(400).json({ success: false, message: 'Captcha verification failed. Please complete the captcha and try again.' });
  }
  next();
};

router.post('/enroll', enrollUser);
router.get('/status', authenticateJWT, getUsersByStatus);
router.get('/enrollments/mine', authenticateJWT, getMyEnrollments);

// Update and delete enrollment
router.put('/enrollments/:enrollmentId', authenticateJWT, updateEnrollment);
router.delete('/enrollments/:enrollmentId', authenticateJWT, deleteEnrollment);

// Progress and certificate routes
router.put('/enrollments/:enrollmentId/progress', authenticateJWT, updateEnrollmentProgress);
router.post('/enrollments/:enrollmentId/certificate', authenticateJWT, issueCertificate);

// Instructor rating/review (post-completion)
router.post('/enrollments/:enrollmentId/review', authenticateJWT, submitInstructorReview);
router.get('/enrollments/:enrollmentId/review', authenticateJWT, getInstructorReviewForEnrollment);

router.post('/submit-instructor', applicationLimiter, (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Maximum size is 5 MB.'
        : err.message || 'File upload error.';
      return res.status(400).json({ success: false, message: msg });
    }
    next();
  });
}, requireCaptcha('submit-instructor'), InstructorForm);

router.post('/submit-internship', applicationLimiter, (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Maximum size is 5 MB.'
        : err.message || 'File upload error.';
      return res.status(400).json({ success: false, message: msg });
    }
    next();
  });
}, requireCaptcha('submit-internship'), submitInternApplication);


export default router;