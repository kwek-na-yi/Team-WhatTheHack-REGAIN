// Writes the synthetic demo dataset to public/samples/ (same data the app loads in one click).
import fs from "node:fs";
import path from "node:path";
import { generateMessySample, generateSample, IV_HEADERS, rowsToCsv, TX_HEADERS } from "../src/lib/sampleData";

const dir = path.join(process.cwd(), "public", "samples");
fs.mkdirSync(dir, { recursive: true });
const { transactions, interventions } = generateSample();
fs.writeFileSync(path.join(dir, "regain_sample_transactions.csv"), rowsToCsv(TX_HEADERS, transactions));
fs.writeFileSync(path.join(dir, "regain_sample_interventions.csv"), rowsToCsv(IV_HEADERS, interventions));
fs.writeFileSync(path.join(dir, "regain_messy_sample.csv"), generateMessySample());
console.log(`Wrote ${transactions.length} transaction lines and ${interventions.length} intervention records to ${dir}`);
