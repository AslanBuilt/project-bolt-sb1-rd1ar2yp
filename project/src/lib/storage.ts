import { supabase } from './supabase';

const BUCKET_NAME = 'clothing-photos';

/**
 * Upload a clothing photo to the user's folder in storage
 * Returns the storage path (not a full URL) to be stored in the database
 */
export async function uploadClothingPhoto(
  file: File,
  userId: string,
  id: string
): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${userId}/${id}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      cacheControl: '31536000',
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  // Return the storage path, not a URL
  return path;
}

/**
 * Generate a signed URL for a storage path
 * This works for private buckets where public URLs don't work
 */
export async function getSignedUrl(path: string, expiresIn: number = 3600): Promise<string> {
  // If the path is already a full URL (legacy data), extract the path from it
  const storagePath = extractPathFromUrl(path);

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, expiresIn);

  if (error) {
    console.error('Error creating signed URL:', error);
    // Return the original path as fallback (might not work but better than nothing)
    return path;
  }

  return data.signedUrl;
}

/**
 * Generate signed URLs for multiple paths at once
 */
export async function getSignedUrls(paths: string[], expiresIn: number = 3600): Promise<Map<string, string>> {
  const urlMap = new Map<string, string>();

  if (paths.length === 0) return urlMap;

  // Extract storage paths from any full URLs (legacy data)
  const storagePaths = paths.map(extractPathFromUrl);

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrls(storagePaths, expiresIn);

  if (error) {
    console.error('Error creating signed URLs:', error);
    // Return original paths as fallback
    paths.forEach(path => urlMap.set(path, path));
    return urlMap;
  }

  // Map original paths to signed URLs
  paths.forEach((originalPath, index) => {
    const signedUrl = data?.[index]?.signedUrl;
    if (signedUrl) {
      urlMap.set(originalPath, signedUrl);
    } else {
      urlMap.set(originalPath, originalPath);
    }
  });

  return urlMap;
}

/**
 * Extract storage path from a full URL (for legacy data migration)
 * Input: https://xxx.supabase.co/storage/v1/object/public/clothing-photos/user-id/image.jpg
 * Output: user-id/image.jpg
 */
function extractPathFromUrl(urlOrPath: string): string {
  // If it's already just a path (no http), return as-is
  if (!urlOrPath.startsWith('http')) {
    return urlOrPath;
  }

  try {
    const url = new URL(urlOrPath);
    // Match pattern: /storage/v1/object/public/{bucket}/{path}
    // or: /storage/v1/object/sign/{bucket}/{path}
    const pathMatch = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)$/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }
  } catch {
    // Not a valid URL, return as-is
  }

  return urlOrPath;
}

/**
 * Upload an inspiration photo to the user's folder in storage
 * Returns the storage path (not a full URL) to be stored in the database
 */
export async function uploadInspirationPhoto(
  file: File,
  userId: string,
  id: string
): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${userId}/inspiration/${id}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      cacheControl: '31536000',
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  return path;
}

/**
 * Delete a clothing photo from storage
 */
export async function deleteClothingPhoto(path: string): Promise<void> {
  const storagePath = extractPathFromUrl(path);
  const { error } = await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
  if (error) {
    throw error;
  }
}
