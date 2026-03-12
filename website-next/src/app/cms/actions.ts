'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  clearCmsSession,
  createCmsSession,
  isCmsAuthenticated,
  validateCmsPassword,
} from '@/lib/cms-auth';
import { type BlogStatus, upsertBlogPost } from '@/lib/blog-cms';

export type SavePostActionState = {
  error: string | null;
};

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function getTags(formData: FormData) {
  return getString(formData, 'tags')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getStatus(formData: FormData): BlogStatus {
  const intent = getString(formData, 'intent');
  if (intent === 'publish') {
    return 'published';
  }

  const status = getString(formData, 'status');
  if (status === 'published' || status === 'review') {
    return status;
  }

  return 'draft';
}

export async function loginAction(formData: FormData) {
  const password = getString(formData, 'password');

  if (!validateCmsPassword(password)) {
    redirect('/cms/login?error=invalid');
  }

  await createCmsSession();
  redirect('/cms');
}

export async function logoutAction() {
  await clearCmsSession();
  redirect('/cms/login');
}

export async function savePostAction(
  _previousState: SavePostActionState,
  formData: FormData,
): Promise<SavePostActionState> {
  if (!(await isCmsAuthenticated())) {
    redirect('/cms/login');
  }

  try {
    const id = getString(formData, 'id') || undefined;
    const saved = await upsertBlogPost({
      id,
      slug: getString(formData, 'slug'),
      title: getString(formData, 'title'),
      description: getString(formData, 'description'),
      body: getString(formData, 'body'),
      status: getStatus(formData),
      author: getString(formData, 'author'),
      tags: getTags(formData),
      seoTitle: getString(formData, 'seoTitle'),
      seoDescription: getString(formData, 'seoDescription'),
      publishedAt: getString(formData, 'publishedAt'),
    });

    revalidatePath('/blog');
    revalidatePath(`/blog/${saved.slug}`);
    revalidatePath('/cms');
    revalidatePath(`/cms/${saved.id}`);
    revalidatePath(`/cms/preview/${saved.id}`);

    redirect(`/cms/${saved.id}?saved=1`);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to save the post.',
    };
  }
}
