import express from 'express';
import upload from '../middleware/upload.js';
import { enrollUser, getUsersByStatus } from '../controllers/enrollment.controller.js';
import { InstructorForm } from '../controllers/instructorForm.controller.js';

const router = express.Router();

router.post('/enroll', enrollUser);
router.get('/status',getUsersByStatus)

router.post('/submit-instructor', upload.single('resume'), InstructorForm);


export default router; 