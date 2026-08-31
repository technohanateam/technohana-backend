
import dotenv from "dotenv";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fs from "fs";

dotenv.config({
    path :"../.env"
});

// Create uploads directory if it doesn't exist
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Use disk storage for reliable file uploads
const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const filename = crypto.randomBytes(16).toString("hex") + path.extname(file.originalname);
        cb(null, filename);
    }
});

const upload = multer({
    storage: diskStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function(req, file, cb) {
        const allowedExts = /\.(pdf|doc|docx)$/i;
        const allowedMimes = [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ];
        const extname = allowedExts.test(path.extname(file.originalname));
        const mimeType = allowedMimes.includes(file.mimetype);
        if (extname && mimeType) {
            return cb(null, true);
        } else {
            cb(new Error("Invalid file type. Only PDF, DOC, and DOCX files are allowed."));
        }
    }
});

// Memory-storage, PDF-only variant for handlers that need the file buffer
// in-process (e.g. pdf-parse) rather than a path on disk.
export const uploadPdfMemory = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: function(req, file, cb) {
        const extname = /\.pdf$/i.test(path.extname(file.originalname));
        const mimeType = file.mimetype === "application/pdf";
        if (extname && mimeType) {
            return cb(null, true);
        } else {
            cb(new Error("Invalid file type. Only PDF files are allowed."));
        }
    }
});

export default upload;