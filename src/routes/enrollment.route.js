import express from 'express';
import upload from '../middleware/upload.js';
import { enrollUser, getUsersByStatus, getMyEnrollments, updateEnrollmentProgress, issueCertificate } from '../controllers/enrollment.controller.js';
import { InstructorForm } from '../controllers/instructorForm.controller.js';
import { authenticateJWT } from '../middleware/authenticateJWT.js';

const router = express.Router();

router.post('/enroll', enrollUser);
router.get('/status', getUsersByStatus);
router.get('/enrollments/mine', authenticateJWT, getMyEnrollments);

// Progress and certificate routes
router.put('/enrollments/:enrollmentId/progress', authenticateJWT, updateEnrollmentProgress);
router.post('/enrollments/:enrollmentId/certificate', authenticateJWT, issueCertificate);

router.post('/submit-instructor', upload.single('resume'), InstructorForm);


export default router; 