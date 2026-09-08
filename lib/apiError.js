export function errorMessage(err) {
  console.error(err);
  if (process.env.NODE_ENV === "production") {
    return "Terjadi kesalahan pada server.";
  }
  return (err && err.message) || "Terjadi kesalahan di server.";
}
