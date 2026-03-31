import getCloudinary from '../config/cloudinary.js';

/**
 * Upload a base64 image to Cloudinary
 * @param {string} base64String - The base64 encoded image (with or without data URI prefix)
 * @param {string} folder - Cloudinary folder to store in
 * @returns {Promise<string>} - The Cloudinary secure URL
 */
export const uploadBase64Image = async (base64String, folder = 'listings') => {
  // Ensure proper data URI format
  let dataUri = base64String;
  if (!dataUri.startsWith('data:')) {
    dataUri = `data:image/jpeg;base64,${dataUri}`;
  }

  const result = await getCloudinary().uploader.upload(dataUri, {
    folder: `aloo_mandi/${folder}`,
    resource_type: 'image',
    transformation: [
      { quality: 'auto:good', fetch_format: 'auto' }, // auto-optimize
      { width: 800, height: 800, crop: 'limit' }, // max 800x800, keep aspect ratio
    ],
  });

  return result.secure_url;
};

/**
 * Upload multiple base64 images to Cloudinary
 * @param {string[]} base64Images - Array of base64 encoded images
 * @param {string} folder - Cloudinary folder
 * @returns {Promise<string[]>} - Array of Cloudinary secure URLs
 */
export const uploadMultipleImages = async (base64Images, folder = 'listings') => {
  if (!base64Images || base64Images.length === 0) return [];

  const uploadPromises = base64Images.map((img) => uploadBase64Image(img, folder));
  return Promise.all(uploadPromises);
};

/**
 * Delete an image from Cloudinary by URL
 * @param {string} imageUrl - The Cloudinary image URL
 */
export const deleteCloudinaryImage = async (imageUrl) => {
  try {
    // Extract public_id from URL
    // URL format: https://res.cloudinary.com/{cloud}/image/upload/v{version}/{folder}/{public_id}.{ext}
    const parts = imageUrl.split('/');
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx === -1) return;

    // Get everything after 'upload/v{version}/' and remove extension
    const pathAfterUpload = parts.slice(uploadIdx + 2).join('/');
    const publicId = pathAfterUpload.replace(/\.[^/.]+$/, '');

    await getCloudinary().uploader.destroy(publicId);
  } catch (error) {
    console.error('Error deleting image from Cloudinary:', error.message);
  }
};
