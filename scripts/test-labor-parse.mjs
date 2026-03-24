import { fetchChicagoFedLabor } from "../lib/labor/chicagoFed.js";

const r = await fetchChicagoFedLabor();
console.log(JSON.stringify(r, null, 2));
