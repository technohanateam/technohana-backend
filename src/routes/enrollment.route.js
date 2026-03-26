import express from 'express';
import upload from '../middleware/upload.js';
import { enrollUser, getUsersByStatus, getMyEnrollments, updateEnrollmentProgress, issueCertificate, updateEnrollment, deleteEnrollment } from '../controllers/enrollment.controller.js';
import { InstructorForm } from '../controllers/instructorForm.controller.js';
import { authenticateJWT } from '../middleware/authenticateJWT.js';

const router = express.Router();

router.post('/enroll', enrollUser);
router.get('/status', getUsersByStatus);
router.get('/enrollments/mine', authenticateJWT, getMyEnrollments);

// Update and delete enrollment
router.put('/enrollments/:enrollmentId', authenticateJWT, updateEnrollment);
router.delete('/enrollments/:enrollmentId', authenticateJWT, deleteEnrollment);

// Progress and certificate routes
router.put('/enrollments/:enrollmentId/progress', authenticateJWT, updateEnrollmentProgress);
router.post('/enrollments/:enrollmentId/certificate', authenticateJWT, issueCertificate);

router.post('/submit-instructor', (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Maximum size is 5 MB.'
        : err.message || 'File upload error.';
      return res.status(400).json({ success: false, message: msg });
    }
    next();
  });
}, InstructorForm);


export default router; 