// web/app/page.tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

export default async function Home() {
  const host = (await headers()).get('host') || '';
  const isPreviewDeployment =
    host.endsWith('.vercel.app') &&
    host !== 'p-3-0.vercel.app' &&
    host !== 'cresco-crm.vercel.app';
  if (isPreviewDeployment) {
    redirect('/admin/direct');
  }
  redirect('/admin/login');
}
