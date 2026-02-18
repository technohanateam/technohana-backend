import express from 'express';
import upload from '../middleware/upload.js';
import { enrollUser, getUsersByStatus, getMyEnrollments } from '../controllers/enrollment.controller.js';
import { InstructorForm } from '../controllers/instructorForm.controller.js';
import { authenticateJWT } from '../middleware/authenticateJWT.js';

const router = express.Router();

router.post('/enroll', enrollUser);
router.get('/status', getUsersByStatus);
router.get('/enrollments/mine', authenticateJWT, getMyEnrollments);

router.post('/submit-instructor', upload.single('resume'), InstructorForm);


export default router; 