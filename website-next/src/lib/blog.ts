import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface BlogPost {
  slug: string;
  data: {
    title: string;
    description?: string;
    date?: string;
    pubDate?: string;
    [key: string]: any;
  };
  content: string;
}

const blogDir = path.join(process.cwd(), 'content/blog');

export function getPosts(): BlogPost[] {
  if (!fs.existsSync(blogDir)) {
    return [];
  }

  const files = fs.readdirSync(blogDir);
  const posts = files
    .filter((file) => file.endsWith('.md') || file.endsWith('.mdx'))
    .map((filename) => {
      const filePath = path.join(blogDir, filename);
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const { data, content } = matter(fileContent);

      // Extract slug from filename (remove date prefix and extension)
      const slug = filename
        .replace(/^\d{4}-\d{2}-\d{2}-/, '')
        .replace(/\.(md|mdx)$/, '');

      return {
        slug,
        data: data as BlogPost['data'],
        content,
      };
    });

  // Sort by date (newest first)
  return posts.sort((a, b) => {
    const dateA = new Date(a.data.date ?? a.data.pubDate ?? 0);
    const dateB = new Date(b.data.date ?? b.data.pubDate ?? 0);
    return dateB.getTime() - dateA.getTime();
  });
}
