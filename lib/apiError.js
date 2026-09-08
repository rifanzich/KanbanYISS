export function errorMessage(err) {
  console.error(err);
  return (err && err.message) || "Terjadi kesalahan di server.";
}
