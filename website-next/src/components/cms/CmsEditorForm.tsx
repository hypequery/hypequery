'use client';

import { useActionState, useRef } from 'react';
import {
  savePostAction,
  type SavePostActionState,
} from '@/app/cms/actions';
import type { BlogPostRecord } from '@/lib/blog-cms';

interface CmsEditorFormProps {
  post?: BlogPostRecord | null;
}

type MarkdownControl = {
  label: string;
  title: string;
  apply: (value: string, start: number, end: number) => {
    nextValue: string;
    selectionStart: number;
    selectionEnd: number;
  };
};

function formatDateTimeLocal(value: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function insertAroundSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after = '',
) {
  const selected = value.slice(start, end);
  const nextValue = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  const selectionStart = start + before.length;
  const selectionEnd = selectionStart + selected.length;

  return {
    nextValue,
    selectionStart,
    selectionEnd,
  };
}

function insertBlock(
  value: string,
  start: number,
  end: number,
  block: string,
) {
  const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const suffix = end < value.length && value[end] !== '\n' ? '\n' : '';
  const nextValue = `${value.slice(0, start)}${prefix}${block}${suffix}${value.slice(end)}`;
  const caret = start + prefix.length + block.length;

  return {
    nextValue,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

const markdownControls: MarkdownControl[] = [
  {
    label: 'H1',
    title: 'Insert heading level 1',
    apply: (value, start, end) => insertBlock(value, start, end, '# Heading\n'),
  },
  {
    label: 'H2',
    title: 'Insert heading level 2',
    apply: (value, start, end) => insertBlock(value, start, end, '## Section title\n'),
  },
  {
    label: 'Bold',
    title: 'Wrap selection in bold markdown',
    apply: (value, start, end) => insertAroundSelection(value, start, end, '**', '**'),
  },
  {
    label: 'Italic',
    title: 'Wrap selection in italic markdown',
    apply: (value, start, end) => insertAroundSelection(value, start, end, '_', '_'),
  },
  {
    label: 'Quote',
    title: 'Insert blockquote',
    apply: (value, start, end) => insertBlock(value, start, end, '> Quote\n'),
  },
  {
    label: 'List',
    title: 'Insert bullet list',
    apply: (value, start, end) => insertBlock(value, start, end, '- First item\n- Second item\n'),
  },
  {
    label: 'Numbered',
    title: 'Insert numbered list',
    apply: (value, start, end) => insertBlock(value, start, end, '1. First item\n2. Second item\n'),
  },
  {
    label: 'Link',
    title: 'Insert markdown link',
    apply: (value, start, end) => insertAroundSelection(value, start, end, '[', '](https://example.com)'),
  },
  {
    label: 'Image',
    title: 'Insert markdown image',
    apply: (value, start, end) => insertBlock(value, start, end, '![Alt text](/blog/image.png)\n'),
  },
  {
    label: 'Code',
    title: 'Insert fenced code block',
    apply: (value, start, end) => insertBlock(value, start, end, '```ts\n// code\n```\n'),
  },
];

export default function CmsEditorForm({ post }: CmsEditorFormProps) {
  const isNew = !post;
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [state, formAction, pending] = useActionState<SavePostActionState, FormData>(
    savePostAction,
    { error: null },
  );

  function applyControl(control: MarkdownControl) {
    const textarea = bodyRef.current;
    if (!textarea) {
      return;
    }

    const { selectionStart, selectionEnd, value } = textarea;
    const result = control.apply(value, selectionStart, selectionEnd);
    textarea.value = result.nextValue;
    textarea.focus();
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
  }

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="id" defaultValue={post?.id ?? ''} />

      <section className="grid gap-6 rounded-3xl border border-gray-800 bg-gray-950/70 p-6 lg:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-medium text-gray-200">Title</span>
          <input
            type="text"
            name="title"
            defaultValue={post?.title ?? ''}
            placeholder="A guide to materialized views in ClickHouse"
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-gray-500"
            required
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-gray-200">Slug</span>
          <input
            type="text"
            name="slug"
            defaultValue={post?.slug ?? ''}
            placeholder="guide-to-materialized-views-in-clickhouse"
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-gray-500"
            required
          />
        </label>

        <label className="space-y-2 lg:col-span-2">
          <span className="text-sm font-medium text-gray-200">Description</span>
          <textarea
            name="description"
            defaultValue={post?.description ?? ''}
            rows={3}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-gray-500"
            placeholder="What the post covers and why it matters."
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-gray-200">Author</span>
          <input
            type="text"
            name="author"
            defaultValue={post?.author ?? ''}
            placeholder="Luke Reilly"
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-gray-500"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-gray-200">Status</span>
          <select
            name="status"
            defaultValue={post?.status ?? 'draft'}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none"
          >
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="published">Published</option>
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-gray-200">Published at</span>
          <input
            type="datetime-local"
            name="publishedAt"
            defaultValue={formatDateTimeLocal(post?.publishedAt ?? null)}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none ring-0"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-gray-200">Tags</span>
          <input
            type="text"
            name="tags"
            defaultValue={post?.tags.join(', ') ?? ''}
            placeholder="clickhouse, analytics, typescript"
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-gray-500"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-gray-200">SEO title</span>
          <input
            type="text"
            name="seoTitle"
            defaultValue={post?.seoTitle ?? ''}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-gray-500"
          />
        </label>

        <label className="space-y-2 lg:col-span-2">
          <span className="text-sm font-medium text-gray-200">SEO description</span>
          <textarea
            name="seoDescription"
            defaultValue={post?.seoDescription ?? ''}
            rows={3}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-gray-500"
          />
        </label>
      </section>

      <section className="rounded-3xl border border-gray-800 bg-gray-950/70 p-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <span className="text-sm font-medium text-gray-200">Markdown body</span>
              <p className="mt-1 text-xs text-gray-500">
                Use the toolbar to insert common markdown patterns without memorizing syntax.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {markdownControls.map((control) => (
                <button
                  key={control.label}
                  type="button"
                  title={control.title}
                  onClick={() => applyControl(control)}
                  className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-800"
                >
                  {control.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-gray-800 bg-black/40 p-4 text-xs text-gray-400 lg:grid-cols-4">
            <div><span className="text-gray-200">Headings</span>: `#` and `##`</div>
            <div><span className="text-gray-200">Emphasis</span>: `**bold**`, `_italic_`</div>
            <div><span className="text-gray-200">Code</span>: fenced blocks with a language like `ts`</div>
            <div><span className="text-gray-200">Media</span>: `![Alt text](/path)`</div>
          </div>

          <textarea
            ref={bodyRef}
            name="body"
            defaultValue={post?.body ?? ''}
            rows={28}
            className="mt-2 min-h-[520px] w-full rounded-2xl border border-gray-700 bg-black px-4 py-4 font-mono text-sm leading-7 text-gray-100 outline-none ring-0 placeholder:text-gray-600"
            placeholder={`# ${isNew ? 'New post' : post?.title}\n\nStart writing here...`}
            required
          />
        </div>
      </section>

      {state.error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
          {state.error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {pending ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="submit"
          name="intent"
          value="publish"
          disabled={pending}
          className="rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-900"
        >
          {pending ? 'Saving…' : 'Publish live'}
        </button>
      </div>
    </form>
  );
}
