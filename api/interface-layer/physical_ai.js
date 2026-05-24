export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({
    layer: "physical_ai",
    integration_status: "stub_ready_manual_mode",
    fetched_at: new Date().toISOString(),
    signals: [
      { id: "physical_production_hours", status: "manual_input" },
      { id: "physical_ur_asp", status: "manual_input" },
      { id: "physical_job_deployment_ratio", status: "manual_input" },
      { id: "physical_sim_to_real_reliability", status: "manual_input" },
    ],
  });
}
