import "dotenv/config";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const imagesDirectory = path.join(projectRoot, "docs", "images");
const baseUrl = process.env.BASE_URL || "http://localhost:5173";
const orderStorageKey = "stitch-desk.orders";
const customerStorageKey = "stitch-desk.customers";
const draftStorageKey = "stitch-desk.order-draft";

function dateAfter(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function measurementMap(pairs) {
  return Object.fromEntries(pairs);
}

function order(id, customer, garment, designNotes, total, advance, status, daysUntilDelivery, measurements) {
  return {
    id,
    customer,
    garment,
    design_notes: designNotes,
    total,
    advance,
    status,
    delivery_date: dateAfter(daysUntilDelivery),
    measurements: measurementMap(measurements),
    references: [],
    created_at: new Date(Date.now() - Math.max(0, 4 - daysUntilDelivery) * 86400000).toISOString(),
  };
}

const orders = [
  order(
    "demo-anna",
    "Anna",
    "bridal lehenga",
    "Boat neck blouse, deep U back, heavy zari work, can-can lining",
    24000,
    10000,
    "Stitching",
    20,
    [
      ["blouse bust", 36], ["blouse waist", 30], ["shoulder", 14], ["blouse length", 15],
      ["sleeve length", 12], ["armhole", 17], ["front neck depth", 7], ["back neck depth", 9],
      ["lehenga waist", 30], ["hip", 38], ["lehenga length", 41],
    ],
  ),
  order(
    "demo-maya",
    "Maya",
    "salwar kameez",
    "Round neck, three-quarter sleeves, straight pants",
    3500,
    1000,
    "Trial pending",
    1,
    [
      ["bust", 36], ["waist", 31], ["hip", 38], ["shoulder", 14], ["kameez length", 42],
      ["sleeve length", 17], ["armhole", 17], ["neck depth", 6], ["salwar length", 38],
      ["ankle width", 8],
    ],
  ),
  order(
    "demo-sara",
    "Sara",
    "salwar kameez",
    "V neck, full sleeves, palazzo",
    4200,
    4200,
    "Ready",
    3,
    [
      ["bust", 34], ["waist", 28], ["hip", 37], ["shoulder", 13], ["kameez length", 40],
      ["sleeve length", 22], ["armhole", 16], ["neck depth", 7], ["salwar length", 39],
      ["ankle width", 9],
    ],
  ),
  order(
    "demo-nina",
    "Nina",
    "bridal lehenga",
    "Sweetheart neck blouse, cut-sleeves, net dupatta",
    32000,
    12000,
    "New",
    6,
    [
      ["blouse bust", 34], ["blouse waist", 28], ["shoulder", 13], ["blouse length", 14],
      ["sleeve length", 6], ["armhole", 16], ["front neck depth", 8], ["back neck depth", 10],
      ["lehenga waist", 29], ["hip", 37], ["lehenga length", 40],
    ],
  ),
];

const customers = [
  { key: "anna", name: "Anna", phone: "9000000001" },
  { key: "maya", name: "Maya", phone: "9000000002" },
  { key: "sara", name: "Sara", phone: "9000000003" },
  { key: "nina", name: "Nina", phone: "9000000004" },
];

const newOrderNote =
  `Anna, bridal lehenga, boat neck blouse, deep U back, bust 36, waist 30, delivery ${dateAfter(20)}, total 24000, advance 10000`;

async function serverIsAvailable(page) {
  try {
    const response = await page.request.get(`${baseUrl}/api/design-search`);
    return response.status() === 400;
  } catch {
    return false;
  }
}

async function ollamaIsAvailable() {
  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) {
      return false;
    }
    const data = await response.json();
    return Array.isArray(data.models) &&
      data.models.some((model) => model.name === "gemma3:4b" || model.name.startsWith("gemma3:4b:"));
  } catch {
    return false;
  }
}

async function capture(page, filename) {
  await page.screenshot({
    path: path.join(imagesDirectory, filename),
    fullPage: true,
    animations: "disabled",
    style: `
      .bottom-nav, .floating-new-order { display: none !important; }
    `,
  });
}

async function selectTab(page, name) {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
}

async function openCustomer(page, name) {
  await selectTab(page, "Customers");
  const backButton = page.locator(".customer-detail .back-button");
  if (await backButton.count()) {
    await backButton.click();
    await page.getByRole("heading", { name: "Customers", exact: true }).waitFor({ state: "visible" });
  }
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  await page.getByRole("heading", { name, exact: true }).waitFor({ state: "visible" });
}

async function fillManualNewOrder(page) {
  const orderFields = {
    Customer: "Anna",
    Garment: "bridal lehenga",
    "Design notes": "Boat neck blouse, deep U back",
  };
  for (const [label, value] of Object.entries(orderFields)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel("Delivery date", { exact: true }).fill(dateAfter(20));
  const measurements = [
    ["bust", "36"],
    ["waist", "30"],
  ];
  await page.getByRole("button", { name: "Add measurement", exact: true }).click();
  await page.getByRole("button", { name: "Add measurement", exact: true }).click();
  for (const [index, [name, value]] of measurements.entries()) {
    await page.getByLabel(`Measurement ${index + 1} name`).fill(name);
    await page.getByLabel(`Measurement ${index + 1} value`).fill(value);
  }
  await page.getByLabel("Total", { exact: true }).fill("24000");
  await page.getByLabel("Advance", { exact: true }).fill("10000");
}

await mkdir(imagesDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(
    ({ orderKey, customerKey, draftKey, demoOrders, demoCustomers }) => {
      localStorage.setItem(orderKey, JSON.stringify(demoOrders));
      localStorage.setItem(customerKey, JSON.stringify(demoCustomers));
      localStorage.removeItem(draftKey);
    },
    {
      orderKey: orderStorageKey,
      customerKey: customerStorageKey,
      draftKey: draftStorageKey,
      demoOrders: orders,
      demoCustomers: customers,
    },
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Orders", exact: true }).waitFor({ state: "visible" });
  await page.locator(".order-card").first().waitFor({ state: "visible" });
  await capture(page, "01-orders.png");
  console.log("Saved docs/images/01-orders.png");

  await selectTab(page, "New");
  await page.getByLabel("Order note", { exact: true }).fill(newOrderNote);
  await page.getByRole("button", { name: "Create card", exact: true }).click();
  await page.getByLabel("Customer", { exact: true }).waitFor({ state: "visible", timeout: 90000 });

  if (!(await ollamaIsAvailable())) {
    await fillManualNewOrder(page);
    console.log("Ollama is unavailable; filled the New order form by hand.");
  } else {
    const parsed = await page.getByLabel("Customer", { exact: true }).inputValue();
    if (!parsed.trim()) {
      await fillManualNewOrder(page);
      console.log("Ollama did not produce a usable card; filled the New order form by hand.");
    }
  }
  await page.getByText("AI draft, please check", { exact: true }).waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await capture(page, "02-new-order.png");
  console.log("Saved docs/images/02-new-order.png");

  await openCustomer(page, "Maya");
  await page.getByRole("button", { name: "Ready for trial", exact: true }).click();
  await page.locator("#customer-message-text").waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const message = document.querySelector("#customer-message-text");
    return Boolean(message && message.value.trim());
  }, { timeout: 90000 });
  await capture(page, "03-customer-salwar.png");
  console.log("Saved docs/images/03-customer-salwar.png");

  await openCustomer(page, "Anna");
  await page.getByText("Latest measurements", { exact: true }).waitFor({ state: "visible" });
  await capture(page, "04-customer-lehenga.png");
  console.log("Saved docs/images/04-customer-lehenga.png");

  if (!process.env.SERPAPI_KEY?.trim()) {
    console.log("Skipped docs/images/05-designs.png: SERPAPI_KEY is not configured.");
  } else if (!(await serverIsAvailable(page))) {
    console.log("Skipped docs/images/05-designs.png: the design-search server is not running.");
  } else {
    await selectTab(page, "Designs");
    await page.getByLabel("Describe a design to search").fill("bridal lehnga latest designs");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const hasResults = page.locator(".design-results").waitFor({ state: "visible", timeout: 90000 }).then(() => true).catch(() => false);
    const hasError = page.locator(".design-search-error").waitFor({ state: "visible", timeout: 90000 }).then(() => false).catch(() => false);
    const foundResults = await Promise.race([hasResults, hasError]);
    if (foundResults) {
      await page.locator(".design-results .design-result-card").first().waitFor({ state: "visible" });
      await page.locator(".design-results img").evaluateAll((images) => {
        for (const image of images) {
          image.loading = "eager";
        }
      });
      await page.evaluate(async () => {
        await Promise.all(
          [...document.images].map((image) =>
            image.decode().catch(() => undefined),
          ),
        );
      });
      await capture(page, "05-designs.png");
      console.log("Saved docs/images/05-designs.png");
    } else {
      console.log("Skipped docs/images/05-designs.png: the design search did not return results.");
    }
  }
} finally {
  await browser.close();
}
