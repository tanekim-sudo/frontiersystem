export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({
    layer: "agent",
    integration_status: "stub_ready_manual_mode_with_legacy_signals",
    fetched_at: new Date().toISOString(),
    signals: [
      { id: "agent_osworld_success", status: "manual_input" },
      { id: "agent_job_deployment_ratio", status: "manual_input" },
      { id: "agent_gov_commit_velocity", status: "manual_input" },
      { id: "agent_nrr_margin_signature", status: "manual_input" },
      { id: "agent_pilot_to_prod", status: "manual_input" },
    ],
    legacy_signals_preserved: ["theirstack", "google_trends", "github_repos", "claude_attrib", "hf_downloads", "macro_pulse"],
  });
}
