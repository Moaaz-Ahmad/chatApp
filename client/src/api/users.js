const BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

export async function searchUsers(email, token) {
  const res = await fetch(
    `${BASE}/users/search?email=${encodeURIComponent(email)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    }
  );
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}
