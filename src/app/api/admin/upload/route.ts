import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

import { getFirebaseAdminAuth } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const ADMIN_EMAIL = 'shohozmart247@gmail.com';
const BUCKET = 'shohoz-mart';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const ALLOWED_FOLDERS = new Set([
  'products',
  'banners',
]);

export async function POST(request: NextRequest) {
  try {
    // 1. Get Firebase login token
    const authorization =
      request.headers.get('authorization') || '';

    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return NextResponse.json(
        { error: 'Please login first.' },
        { status: 401 }
      );
    }

    // 2. Verify Firebase token
    let decoded;

    try {
      decoded = await getFirebaseAdminAuth().verifyIdToken(
        match[1],
        true
      );
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired login. Please login again.' },
        { status: 401 }
      );
    }

    // 3. Check admin email
    if (
      decoded.email?.toLowerCase().trim() !== ADMIN_EMAIL
    ) {
      return NextResponse.json(
        { error: 'Admin access only.' },
        { status: 403 }
      );
    }

    // 4. Get uploaded file
    const formData = await request.formData();

    const file = formData.get('file');
    const folder = String(formData.get('folder') || '');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Image file is required.' },
        { status: 400 }
      );
    }

    // 5. Validate folder
    if (!ALLOWED_FOLDERS.has(folder)) {
      return NextResponse.json(
        { error: 'Invalid upload folder.' },
        { status: 400 }
      );
    }

    // 6. Validate image type
    if (!ALLOWED_TYPES[file.type]) {
      return NextResponse.json(
        {
          error: 'Only JPG, PNG, WEBP or GIF images are allowed.',
        },
        { status: 415 }
      );
    }

    // 7. Validate image size
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Image size must be below 5 MB.' },
        { status: 413 }
      );
    }

    // 8. Get Supabase server credentials
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('Supabase server credentials missing.');

      return NextResponse.json(
        { error: 'Server storage configuration is missing.' },
        { status: 500 }
      );
    }

    // 9. Create Supabase server client
    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // 10. Generate unique image path
    const extension = ALLOWED_TYPES[file.type];

    const objectPath =
      `${folder}/${Date.now()}-${randomUUID()}.${extension}`;

    const bytes = Buffer.from(await file.arrayBuffer());

    // 11. Upload image
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, bytes, {
        contentType: file.type,
        upsert: false,
        cacheControl: '3600',
      });

    if (error) {
      console.error('Supabase upload error:', error.message);

      return NextResponse.json(
        { error: 'Could not upload image to Supabase.' },
        { status: 502 }
      );
    }

    // 12. Generate public image URL
    const { data } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(objectPath);

    return NextResponse.json({
      success: true,
      url: data.publicUrl,
      path: objectPath,
    });

  } catch (error) {
    console.error('Admin upload failed:', error);

    return NextResponse.json(
      { error: 'Upload failed. Please try again.' },
      { status: 500 }
    );
  }
}