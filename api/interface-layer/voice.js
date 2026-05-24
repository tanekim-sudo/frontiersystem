export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({
    layer: "voice",
    integration_status: "stub_ready_manual_mode",
    fetched_at: new Date().toISOString(),
    signals: [
      { id: "voice_elevenlabs_arr", status: "manual_input" },
      { id: "voice_cartesia_commit_velocity", status: "manual_input" },
      { id: "voice_ambient_dau_mau", status: "manual_input" },
      { id: "voice_f500_job_velocity", status: "manual_input" },
      { id: "voice_tts_latency", status: "manual_input" },
    ],
  });
}
