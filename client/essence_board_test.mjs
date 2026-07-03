import { chromium } from "playwright";

const BASE = "http://localhost:5173";
const shot = (page, name) => page.screenshot({ path: `/tmp/board_${name}.png` });

const browser = await chromium.launch({ headless: true });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const a = await ctxA.newPage();
const b = await ctxB.newPage();

// Player A creates room
await a.goto(BASE);
await a.waitForLoadState("networkidle");
await a.getByPlaceholder("Tu nombre").fill("Javi");
await a.getByRole("button", { name: "Crear sala" }).click();
await a.getByPlaceholder("Ej. Mesa de Javi").fill("UI Test");
await a.getByRole("button", { name: "Crear", exact: true }).click();
await a.waitForTimeout(1000);
await shot(a, "01_lobby");

// Player B joins via room browser
await b.goto(BASE);
await b.waitForLoadState("networkidle");
await b.getByPlaceholder("Tu nombre").fill("Nico");
await b.getByRole("button", { name: "Unirme" }).click();
await b.waitForTimeout(800);
const room = b.locator("button", { hasText: "UI Test" }).first();
await room.click();
await b.waitForTimeout(1000);

// Start game
await a.getByRole("button", { name: "Arrancar" }).click();
await a.waitForTimeout(3500);
await shot(a, "02_board_initial");

// Roll dice on whichever page has an enabled Tirar button
const rollBtnA = a.getByRole("button", { name: "Tirar" });
const rollBtnB = b.getByRole("button", { name: "Tirar" });
let roller = null;
if ((await rollBtnA.count()) && (await rollBtnA.isEnabled().catch(() => false))) roller = { page: a, btn: rollBtnA };
else if ((await rollBtnB.count()) && (await rollBtnB.isEnabled().catch(() => false))) roller = { page: b, btn: rollBtnB };

if (roller) {
  await roller.btn.click();
  await roller.page.waitForTimeout(450);
  await shot(roller.page, "03_dice_rolling");
  await roller.page.waitForTimeout(1000); // ~1.45s: inside reveal window
  await shot(roller.page, "04_dice_reveal");
  await roller.page.waitForTimeout(800); // still revealing / start of walk
  await shot(roller.page, "05_dice_reveal_late");
  await roller.page.waitForTimeout(1200);
  await shot(roller.page, "06_moving");
  await roller.page.waitForTimeout(2500);
  await shot(roller.page, "07_after_move");
} else {
  console.log("No enabled Tirar button found");
  await shot(a, "err_a");
  await shot(b, "err_b");
}

console.log("done");
await browser.close();
