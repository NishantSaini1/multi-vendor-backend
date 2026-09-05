import path from 'path';
import multer from 'multer';
import { ApiError } from '../utils/ApiError';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
// 'image/jpg' is a non-standard alias some clients (older Android WebViews,
// some Postman/OS mimetype lookups) send instead of the correct 'image/jpeg'.
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Memory storage — the buffer is streamed straight to Cloudinary
// (upload.service) rather than ever touching local disk.
export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    // Some clients send a generic mimetype (e.g. application/octet-stream)
    // for a perfectly valid image — fall back to the file extension rather
    // than rejecting those outright.
    const isAllowedMimeType = ALLOWED_MIME_TYPES.has(file.mimetype);
    const isAllowedExtension = ALLOWED_EXTENSIONS.has(path.extname(file.originalname).toLowerCase());
    if (!isAllowedMimeType && !isAllowedExtension) {
      cb(
        ApiError.badRequest(
          `Only JPEG, PNG, WEBP, and GIF images are supported (received "${file.mimetype}")`,
          'UNSUPPORTED_FILE_TYPE',
        ),
      );
      return;
    }
    cb(null, true);
  },
}).single('image');
