// web/app/page.tsx
import { redirect } from 'next/navigation';

export default function Home() {
  // одразу ведемо на логін адмінки
  redirect('/admin/login');
}
