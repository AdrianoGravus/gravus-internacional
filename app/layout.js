export const metadata = {
  title: 'Gravus · Internacional',
  description: 'Painel global em tempo real - Gravus Capital',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
