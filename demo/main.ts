import { machinePrecision } from "../src/index";

const output = document.querySelector("#precision");

if (output) {
  output.textContent = String(machinePrecision());
}
