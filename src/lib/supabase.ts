import { auth } from '@/lib/firebase';

export const BUCKET = 'shohoz-mart';

export async function uploadImage(
  file: File,
  folder: string
): Promise<string> {
  const user = auth.currentUser;

  if (!user) {
    throw new Error('Please login as admin before uploading.');
  }

  const idToken = await user.getIdToken();

  const formData = new FormData();

  formData.append('file', file);
  formData.append('folder', folder);

  const response = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    body: formData,
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Image upload failed.');
  }

  if (!result.url) {
    throw new Error('Image URL not found.');
  }

  return result.url as string;
}