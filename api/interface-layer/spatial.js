export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  return res.status(200).json({
    layer: "spatial",
    integration_status: "stub_ready_manual_mode",
    fetched_at: new Date().toISOString(),
    signals: [
      { id: "spatial_rayban_units", status: "manual_input" },
      { id: "spatial_himax_revenue", status: "manual_input" },
      { id: "spatial_sdk_downloads", status: "manual_input" },
      { id: "spatial_waveguide_hires", status: "manual_input" },
    ],
  });
}
