import { cloudinary } from '../config/cloudinary';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

export function isCloudinaryConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

const UPLOAD_FOLDER = 'multi-vendor-backend';

export async function uploadImageBuffer(buffer: Buffer, folder = UPLOAD_FOLDER): Promise<{ url: string; publicId: string }> {
  if (!isCloudinaryConfigured()) {
    throw ApiError.internal('Image uploads are not configured on this server', 'UPLOAD_NOT_CONFIGURED');
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, result) => {
      if (err || !result) {
        reject(ApiError.internal('Image upload failed', 'UPLOAD_FAILED'));
        return;
      }
      resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.end(buffer);
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
