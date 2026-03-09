export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: "RESEND_API_KEY not configured on server" });

  const { to, subject, html, from } = req.body || {};
  if (!to || !to.length) return res.status(400).json({ error: "No recipients" });
  if (!html) return res.status(400).json({ error: "No email body" });

  const senderEmail = from || "report@resend.dev";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `AI Demand Signal Report <${senderEmail}>`,
        to: Array.isArray(to) ? to : [to],
        subject: subject || "AI Demand Signal Weekly Intelligence Report",
        html,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `Resend API error: ${err.slice(0, 200)}` });
    }

    const data = await response.json();
    return res.status(200).json({ success: true, id: data.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
