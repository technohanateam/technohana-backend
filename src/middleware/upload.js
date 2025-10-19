
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
    limits: { fileSize: 1 * 1024 * 1024 }, // 1MB limit
    fileFilter: function(req, file, cb) {
        const allowedTypes = /pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimeType = allowedTypes.test(file.mimetype);
        if(extname && mimeType) {
            return cb(null, true);
        } else {
            cb(new Error("Invalid file type. Only PDF, DOC, and DOCX files are allowed."));
        }
    }
});

export default upload;