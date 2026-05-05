import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INVOICES_FILE = path.join(__dirname, "..", "data", "invoices.json");
const USERS_FILE = path.join(__dirname, "..", "data", "users.json");

export async function readInvoices() {
  const raw = await fs.readFile(INVOICES_FILE, "utf-8");
  return JSON.parse(raw);
}

export async function writeInvoices(invoices) {
  await fs.writeFile(INVOICES_FILE, JSON.stringify(invoices, null, 2));
}

export async function updateInvoice(id, updater) {
  const invoices = await readInvoices();
  const invoiceIndex = invoices.findIndex((invoice) => invoice.id === id);

  if (invoiceIndex === -1) {
    return null;
  }

  invoices[invoiceIndex] = updater(invoices[invoiceIndex]);
  await writeInvoices(invoices);

  return invoices[invoiceIndex];
}

export async function readUsers() {
  try {
    const raw = await fs.readFile(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeUsers([]);
      return [];
    }

    throw error;
  }
}

export async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
}
