import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'U+ Content Developer',
  description: 'SEO/GEO 분석 기반 블로그 콘텐츠 최적화 도구',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
