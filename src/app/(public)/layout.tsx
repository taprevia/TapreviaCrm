import { Header } from '@/components/marketing/layout/Header';
import { Footer } from '@/components/marketing/layout/Footer';
import { ChatBubble } from '@/components/marketing/ui/ChatBubble';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div id="cover-site" className="min-h-screen bg-white text-brand-navy flex flex-col antialiased">
      <Header />
      <main className="flex-grow">{children}</main>
      <ChatBubble />
      <Footer />
    </div>
  );
}