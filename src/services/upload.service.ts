import sharp from 'sharp';
import { cloudinary } from '../config/cloudinary';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

export function isCloudinaryConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

const UPLOAD_FOLDER = 'multi-vendor-backend';

// Resize + re-encode the image before upload. Limits:
//   • max 1200 × 1200 px (delivery proof photos don't need more)
//   • JPEG at quality 75, progressive encoding
//   • EXIF stripped (no GPS metadata leakage in uploaded file)
// The output is always a Buffer so the caller doesn't need to change.
export async function compressImageBuffer(buffer: Buffer, maxDimension = 1200, quality = 75): Promise<Buffer> {
  return sharp(buffer)
    .rotate()               // respect EXIF orientation before stripping it
    .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, progressive: true, mozjpeg: true })
    .withMetadata({ exif: {} })  // strip all EXIF
    .toBuffer();
}

export async function uploadImageBuffer(buffer: Buffer, folder = UPLOAD_FOLDER): Promise<{ url: string; publicId: string }> {
  if (!isCloudinaryConfigured()) {
    throw ApiError.internal('Image uploads are not configured on this server', 'UPLOAD_NOT_CONFIGURED');
  }

  const compressed = await compressImageBuffer(buffer);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, result) => {
      if (err || !result) {
        reject(ApiError.internal('Image upload failed', 'UPLOAD_FAILED'));
        return;
      }
      resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.end(compressed);
  });
}

// Same Cloudinary pipeline as images, as a `video` resource. The response
// also carries a poster frame URL (Cloudinary renders any frame of a video
// as a JPG by swapping the extension), handy as the banner's `image`.
export async function uploadVideoBuffer(
  buffer: Buffer,
  folder = UPLOAD_FOLDER,
): Promise<{ url: string; publicId: string; posterUrl: string; duration?: number }> {
  if (!isCloudinaryConfigured()) {
    throw ApiError.internal('Uploads are not configured on this server', 'UPLOAD_NOT_CONFIGURED');
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'video' }, (err, result) => {
      if (err || !result) {
        reject(ApiError.internal('Video upload failed', 'UPLOAD_FAILED'));
        return;
      }
      resolve({
        url: result.secure_url,
        publicId: result.public_id,
        posterUrl: result.secure_url.replace(/\.[a-z0-9]+$/i, '.jpg'),
        duration: typeof result.duration === 'number' ? result.duration : undefined,
      });
    });
    stream.end(buffer);
  });
}

export async function deleteImage(publicId: string): Promise<void> {
  if (!isCloudinaryConfigured()) {
    throw ApiError.internal('Image uploads are not configured on this server', 'UPLOAD_NOT_CONFIGURED');
  }
  await cloudinary.uploader.destroy(publicId);
}
