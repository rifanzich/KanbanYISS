export const metadata = {
  title: "Ruang — Portal Kerja Tim",
  description: "Papan kanban, catatan, dan checklist tugas dalam satu portal.",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#1B2430",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
