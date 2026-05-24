const LAYER_PAYLOADS = {
  physical_ai: {
    layer: "physical_ai",
    integration_status: "stub_ready_manual_mode",
    signals: [
      { id: "physical_production_hours", status: "manual_input" },
      { id: "physical_ur_asp", status: "manual_input" },
      { id: "physical_job_deployment_ratio", status: "manual_input" },
      { id: "physical_sim_to_real_reliability", status: "manual_input" },
    ],
  },
  voice: {
    layer: "voice",
    integration_status: "stub_ready_manual_mode",
    signals: [
      { id: "voice_elevenlabs_arr", status: "manual_input" },
      { id: "voice_cartesia_commit_velocity", status: "manual_input" },
      { id: "voice_ambient_dau_mau", status: "manual_input" },
      { id: "voice_f500_job_velocity", status: "manual_input" },
      { id: "voice_tts_latency", status: "manual_input" },
    ],
  },
  spatial: {
    layer: "spatial",
    integration_status: "stub_ready_manual_mode",
    signals: [
      { id: "spatial_rayban_units", status: "manual_input" },
      { id: "spatial_himax_revenue", status: "manual_input" },
      { id: "spatial_sdk_downloads", status: "manual_input" },
      { id: "spatial_waveguide_hires", status: "manual_input" },
    ],
  },
  agent: {
    layer: "agent",
    integration_status: "stub_ready_manual_mode_with_legacy_signals",
    signals: [
      { id: "agent_osworld_success", status: "manual_input" },
      { id: "agent_job_deployment_ratio", status: "manual_input" },
      { id: "agent_gov_commit_velocity", status: "manual_input" },
      { id: "agent_nrr_margin_signature", status: "manual_input" },
      { id: "agent_pilot_to_prod", status: "manual_input" },
    ],
    legacy_signals_preserved: ["theirstack", "google_trends", "github_repos", "claude_attrib", "hf_downloads", "macro_pulse"],
  },
  neural: {
    layer: "neural",
    integration_status: "stub_ready_manual_mode",
    signals: [
      { id: "neural_patient_implants", status: "manual_input" },
      { id: "neural_electrode_generation", status: "manual_input" },
      { id: "neural_fda_milestones", status: "manual_input" },
      { id: "neural_ultrasound_resolution", status: "manual_input" },
      { id: "neural_s1_signals", status: "manual_input" },
    ],
  },
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const layer = String(req.query?.layer || "").trim();
  if (!layer || !LAYER_PAYLOADS[layer]) {
    return res.status(400).json({
      error: "Missing or invalid 'layer' query parameter.",
      supported_layers: Object.keys(LAYER_PAYLOADS),
    });
  }
  return res.status(200).json({
    ...LAYER_PAYLOADS[layer],
    fetched_at: new Date().toISOString(),
  });
}
