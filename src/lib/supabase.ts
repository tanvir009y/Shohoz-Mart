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

  let response: Response;
  try {
    response = await fetch('/api/admin/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      body: formData,
    });
  } catch (netErr: any) {
    throw new Error(`Network error while connecting to upload API: ${netErr.message}`);
  }

  // যদি সার্ভার HTML এরর রিটার্ন করে (যেমন 404 বা 500)
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const errorText = await response.text();
    console.error('Server returned non-JSON response:', errorText);
    throw new Error(`Upload API failed with status ${response.status} (${response.statusText}). Check server logs.`);
  }

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Image upload failed.');
  }

  if (!result.url) {
    throw new Error('Image URL not found.');
  }

  return result.url as string;
}
