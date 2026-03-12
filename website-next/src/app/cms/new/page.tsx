import { redirect } from 'next/navigation';
import CmsEditorForm from '@/components/cms/CmsEditorForm';
import { isCmsAuthenticated } from '@/lib/cms-auth';

export default async function CmsNewPostPage() {
  if (!(await isCmsAuthenticated())) {
    redirect('/cms/login');
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-indigo-300">Create</p>
        <h1 className="mt-3 text-3xl font-semibold">New blog post</h1>
        <p className="mt-2 text-sm leading-6 text-gray-400">
          Save as a draft or publish immediately. Published entries become live on `/blog` without a deploy.
        </p>
      </div>
      <CmsEditorForm />
    </div>
  );
}
